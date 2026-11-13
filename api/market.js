// Vercel function: /api/market?op=...  (see _market.js for the design)
//   GET  offer                     terms and bonds the house provider accepts
//   POST ratify   {treaty_id}      the house provider checks the proposal on-chain and ratifies it
//   GET  report   &t=              the provider's self-report (a claim, not evidence)
//   GET  feed     &t=&m=a|b        an independent monitor's measurement
//   GET  evidence &t=              the evidence document the hirer commits to on-chain
//   POST vote     {dispute_id, judge}   one TEE judge rules; returns its signed vote
//   POST submit   {dispute_id, votes}   relays the signed votes; the contract verifies them
//   POST exit     {treaty_id}      executes an accepted (request_exit) treaty, releasing both bonds
import * as M from "./_market.js";

export const config = { maxDuration: 60 };
const DAILY_CAP = Number(process.env.LIVE_DAILY_CAP || 40);
const inflight = new Map(); // per-instance dedupe of judge calls

function out(res, code, body, type = "application/json") {
  res.statusCode = code;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
const tidOf = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 1e9) throw new Error("bad treaty id"); return n; };
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let s = ""; for await (const c of req) { s += c; if (s.length > 200_000) throw new Error("body too large"); }
  return s ? JSON.parse(s) : {};
}
async function houseTreaty(tid) {
  const t = await M.view("get_treaty", { treaty_id: tid });
  if (!t || t.party_b !== M.HOUSE || t.terms !== M.TERMS) throw new Error("not a Hire-an-agent treaty");
  return t;
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const op = url.searchParams.get("op");
  try {
    if (op === "offer") return out(res, 200, { contract: M.CONTRACT, house: M.HOUSE, terms: M.TERMS, allegation: M.ALLEGATION, ...M.OFFER, evidence_prefix: M.evidenceUri(""), judges: M.PANEL.map((p) => ({ name: p.name, model: p.model })) });

    if (op === "feed" || op === "evidence" || op === "report") {
      const tid = tidOf(url.searchParams.get("t"));
      if (op === "feed") return out(res, 200, M.feedBody(tid, url.searchParams.get("m")));
      if (op === "evidence") return out(res, 200, M.evidenceDoc(tid));
      await houseTreaty(tid);
      return out(res, 200, M.selfReport(tid));
    }

    if (req.method !== "POST") return out(res, 405, { error: "POST required" });
    const body = await readJson(req);

    if (op === "ratify") {
      const tid = tidOf(body.treaty_id);
      const t = await houseTreaty(tid);
      if (t.status !== "Proposed") return out(res, 409, { error: `treaty is ${t.status}` });
      if (t.bond_b !== M.OFFER.counter_bond || t.bond_a !== M.OFFER.bond || t.duration_ns !== M.OFFER.duration_ns || t.notice_ns !== M.OFFER.notice_ns) return out(res, 400, { error: "bonds or timing differ from the offer" });
      if ((await M.houseDisputesLastDay()).length >= DAILY_CAP) return out(res, 429, { error: "daily limit of live disputes reached; try tomorrow" });
      const r = await M.asHouse("ratify", { treaty_id: tid, terms_hash: t.terms_hash });
      return out(res, r.ok ? 200 : 502, r);
    }

    if (op === "exit") {
      const tid = tidOf(body.treaty_id);
      const t = await houseTreaty(tid);
      if (t.status !== "Exiting") return out(res, 409, { error: `treaty is ${t.status}` });
      return out(res, 200, await M.asRelay("execute_exit", { treaty_id: tid }, 30));
    }

    if (op === "vote" || op === "submit") {
      const id = tidOf(body.dispute_id);
      const d = await M.view("get_dispute", { dispute_id: id });
      if (!d || d.defendant !== M.HOUSE) return out(res, 404, { error: "not a Hire-an-agent dispute" });
      if (d.status !== "Open") return out(res, 409, { error: `dispute is ${d.status}` });
      if (d.evidence_uri !== M.evidenceUri(d.treaty_id)) return out(res, 400, { error: "evidence must be the market's evidence document" });

      if (op === "submit") {
        const votes = (Array.isArray(body.votes) ? body.votes : []).slice(0, 3).map((v) => ({ judge_id: Number(v.judge_id), request_body: String(v.request_body), response_body: String(v.response_body), signature: String(v.signature) }));
        const r = await M.asRelay("submit_verdicts", { dispute_id: id, votes }, 300);
        const after = await M.view("get_dispute", { dispute_id: id });
        return out(res, r.ok ? 200 : 502, { ...r, dispute: after });
      }

      const k = Number(body.judge);
      const p = M.PANEL[k];
      if (!p) return out(res, 400, { error: "judge must be 0, 1 or 2" });
      const key = `${id}/${k}`;
      if (!inflight.has(key)) {
        inflight.set(key, (async () => {
          const deadline = Date.now() + 52_000;
          const t = await M.view("get_treaty", { treaty_id: d.treaty_id });
          const f = await M.facts(d);
          const request_body = M.buildRequest(p, d, t.terms, f);
          const judges = await M.view("list_judges");
          let last;
          // A model may be served by several TEE nodes; only nodes registered on-chain (each with its own
          // attestation report) can count, so retry until a registered node signs or time runs out.
          for (let i = 0; i < 3 && Date.now() < deadline - 8000; i++) {
            last = await M.teeComplete(p.model, request_body, deadline);
            const j = judges.find((x) => x.active && x.model === p.model && x.signing_address === last.signer);
            if (j) return { judge_id: j.id, request_body, response_body: last.response_body, signature: last.signature, signer: last.signer, model: p.model, name: p.name, parsed: M.parseContent(last.response_body), facts: f };
          }
          throw new Error(`TEE node 0x${last?.signer ?? "?"} for ${p.model} is not registered on-chain`);
        })().then((v) => { setTimeout(() => inflight.delete(key), 60_000); return v; }, (e) => { inflight.delete(key); throw e; }));
      }
      return out(res, 200, await inflight.get(key));
    }
    return out(res, 400, { error: "unknown op" });
  } catch (e) {
    return out(res, 500, { error: String(e?.message || e).slice(0, 300) });
  }
}
