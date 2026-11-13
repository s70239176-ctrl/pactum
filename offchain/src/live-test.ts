// `npm run test:live -- --yes [--target=https://pactum-int.vercel.app]`: end-to-end test of "Hire an agent".
// Plays the hirer with the atlas enclave's function-call key (the same calls the browser makes) against
// the live-market API: locally (in-process server, default) or a deployed URL (--target).
// Plays rounds until it has seen one breach and one clean delivery, disputing each, and checks that
// the contract's ruling matches the hidden outcome. Writes evidence/live-market-test.json.
import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { agentAccount, contractId, EXPLORER } from "./chain.ts";
import { actions, teraToGas } from "near-api-js";

const root = new URL("../../", import.meta.url);
if (existsSync(new URL(".env", root))) process.loadEnvFile(new URL(".env", root));
const target = process.argv.find((a) => a.startsWith("--target="))?.slice(9);
const C = contractId();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  if (!process.argv.includes("--yes")) { console.log("Signs testnet transactions with the atlas agent key. Re-run with --yes."); return; }
  let base = target;
  let server: ReturnType<typeof createServer> | undefined;
  if (!base) {
    process.env.MARKET_SECRET ||= "local-test-secret-" + C;
    process.env.FEED_HOST_B ||= "pactum-b.invalid";
    const { default: handler } = await import(new URL("api/market.js", root).href);
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>((ok) => server!.listen(0, ok));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    process.env.DEV_FETCH_BASE = base;
  }
  const api = async (op: string, body?: object, q = "") => {
    const r = await fetch(`${base}/api/market?op=${op}${q}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const j = await r.json();
    if (!r.ok && !j.hash) throw new Error(`${op}: ${j.error}`);
    return j;
  };
  const atlas = agentAccount(`atlas.${C}`, process.env.ATLAS_AGENT_KEY!);
  const call = async (method: string, args: object) => {
    const r = await atlas.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall(method, args, teraToGas("20"), 0n)], throwOnFailure: false }) as any;
    const fail = r.receipts_outcome?.find((x: any) => x.outcome.status?.Failure);
    if (fail) throw new Error(`${method}: ${JSON.stringify(fail.outcome.status.Failure).slice(0, 300)}`);
    return { hash: r.transaction.hash as string, value: r.status?.SuccessValue ? JSON.parse(Buffer.from(r.status.SuccessValue, "base64").toString()) : undefined };
  };
  const o = await api("offer");
  const items: any[] = [];
  const seen = { breach: false, clean: false };
  for (let round = 0; round < 6 && !(seen.breach && seen.clean); round++) {
    const p = await call("propose_treaty", { counterparty: o.house, terms: o.terms, bond: o.bond, counter_bond: o.counter_bond, duration_ns: o.duration_ns, notice_ns: o.notice_ns, params: o.params, telemetry_urls: [] });
    const tid = p.value as number;
    const k = await api("ratify", { treaty_id: tid });
    const ev = await (await fetch(`${base}/api/market?op=evidence&t=${tid}`)).text();
    const doc = JSON.parse(ev);
    const mon = await Promise.all(doc.feeds.map(async (u: string) => (await (await fetch(target ? u : `${base}${new URL(u).pathname}${new URL(u).search}`)).json())[o.house].value_bps));
    const breach = (mon[0] + mon[1]) / 2 < o.floor_bps;
    console.log(`round ${round}: treaty #${tid} ratified ${EXPLORER}${k.hash} · monitors ${mon.join("/")} → ${breach ? "BREACH" : "clean"}`);
    const kind = breach ? "breach" : "clean";
    if (seen[kind]) { // already tested this kind: accept to release bonds
      const x = await call("request_exit", { treaty_id: tid });
      await new Promise((ok) => setTimeout(ok, 2500));
      const e = await api("exit", { treaty_id: tid });
      console.log(`  accepted: request_exit ${EXPLORER}${x.hash} · execute_exit ${e.url}`);
      items.push({ round, treaty: tid, monitors: mon, decision: "accept", propose: p.hash, ratify: k.hash, request_exit: x.hash, execute_exit: e.hash });
      continue;
    }
    seen[kind] = true;
    const d = await call("file_dispute", { treaty_id: tid, allegation: o.allegation, evidence_uri: `${o.evidence_prefix}${tid}`, evidence_sha256: sha(ev), dispute_bond: o.dispute_bond });
    const did = d.value as number;
    console.log(`  dispute #${did} ${EXPLORER}${d.hash}`);
    const t0 = Date.now();
    const votes = await Promise.all([0, 1, 2].map((j) => api("vote", { dispute_id: did, judge: j }).catch((e) => ({ error: String(e.message) }))));
    votes.forEach((v: any, j) => console.log(`  judge ${j}: ${v.error ?? `${v.parsed?.verdict} ${v.parsed?.metric_bps} (on-chain #${v.judge_id})`}`));
    console.log(`  judging took ${Math.round((Date.now() - t0) / 1000)} s`);
    const good = votes.filter((v: any) => !v.error);
    const s = await api("submit", { dispute_id: did, votes: good });
    console.log(`  ruling ${s.dispute?.verdict} (raw ${s.dispute?.raw_verdict}) ${s.url}${s.ok ? "" : " FAILED " + s.error}`);
    const expectOk = breach ? s.dispute?.verdict === "CriticalBreach" : ["Normal", "MaliciousReport"].includes(s.dispute?.verdict);
    items.push({ round, treaty: tid, monitors: mon, decision: "dispute", dispute: did, propose: p.hash, ratify: k.hash, file_dispute: d.hash, submit_verdicts: s.hash, verdict: s.dispute?.verdict, raw: s.dispute?.raw_verdict, judges: s.dispute?.judges, votes: votes.map((v: any) => v.error ? { error: v.error } : { model: v.model, verdict: v.parsed?.verdict, metric_bps: v.parsed?.metric_bps, signer: v.signer, judge_id: v.judge_id }), expected: expectOk });
    if (!s.ok || !expectOk) console.log("  ✘ unexpected outcome");
    if (s.ok && !breach) { // treaty stays in force after a clean-delivery ruling: close it
      const x = await call("request_exit", { treaty_id: tid });
      await new Promise((ok) => setTimeout(ok, 2500));
      const e = await api("exit", { treaty_id: tid });
      console.log(`  closed: ${e.url}`);
    }
  }
  writeFileSync(new URL("evidence/live-market-test.json", root), JSON.stringify({ when: new Date().toISOString(), contract: C, target: target ?? "local", items }, null, 2));
  server?.close();
  const ok = items.filter((i) => i.decision === "dispute").every((i) => i.expected);
  console.log(ok && seen.breach && seen.clean ? "PASS" : "INCOMPLETE/FAIL");
}
main().catch((e) => { console.error(e); process.exit(1); });
