/* PACTUM frontend. No build step. Data sources (never fabricated):
 *  - live:  Pactum contract views over NEAR testnet RPC (?contract=<account>, default below)
 *           + data/testnet-evidence.json (real tx hashes from the recorded testnet run, only when it matches the contract)
 *  - demo:  data/demo-data.json written by `npm run sim` (labelled DEMO everywhere)
 * Routes are hash-based: #/ landing, #/command, #/diplomacy, #/enclaves, #/treaties, #/tribunal, #/simulation, #/events
 */
(() => {
  "use strict";
  const DEFAULT_CONTRACT = "pactum.stunner70.testnet";
  const RPC = "https://test.rpc.fastnear.com";
  const EXPLORER = "https://testnet.nearblocks.io";
  const REPO = "https://github.com/s70239176-ctrl/pactum";

  // ---------------------------------------------------------------- utils
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const short = (a) => String(a ?? "").split(".")[0];
  const shortHash = (h, n = 8) => (h ? `${String(h).slice(0, n)}…${String(h).slice(-4)}` : "");
  const yocto = (y) => { try { return Number(BigInt(y) / 10n ** 21n) / 1000; } catch { return Number(y) || 0; } };
  const near = (n) => `${(+n).toLocaleString(undefined, { maximumFractionDigits: 3 })}`;
  const wire = (v) => (v ? String(v).replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase() : "");
  const nsDate = (ns) => { const n = Number(ns); return n > 1e15 ? new Date(n / 1e6) : null; };
  const fmtDate = (d) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
  const txLink = (h, label) => (h ? `<a class="mono" href="${EXPLORER}/txns/${esc(h)}" target="_blank" rel="noopener">${esc(label || shortHash(h))} ↗</a>` : `<span class="mute">—</span>`);
  const acctLink = (a) => `<a class="mono" href="${EXPLORER}/address/${esc(a)}" target="_blank" rel="noopener">${esc(a)} ↗</a>`;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const VERDICT = {
    CRITICAL_BREACH: { cls: "fail", label: "Critical breach" },
    ELEVATED_RISK: { cls: "dispute", label: "Elevated risk" },
    NORMAL: { cls: "ok", label: "No breach" },
    MALICIOUS_REPORT: { cls: "gold", label: "Malicious report" },
    FEED_CONFLICT: { cls: "neutral", label: "Feed conflict" },
    NO_EVIDENCE: { cls: "neutral", label: "No evidence" },
  };
  const STATUS = { Active: "ok", Proposed: "warn", Disputed: "dispute", Exiting: "warn", Closed: "neutral", Cancelled: "neutral", Expired: "neutral", Open: "dispute", Resolved: "ok" };
  const CHAIN = { near: "#b8f36b", base: "#6f9cf0", ethereum: "#b9a4f2", solana: "#5fd8b0", bitcoin: "#e2a14d" };
  const chip = (cls, text, dot) => `<span class="chip ${cls}">${dot ? '<span class="dot"></span>' : ""}${esc(text)}</span>`;
  const verdictChip = (v) => (v ? chip(VERDICT[v]?.cls || "neutral", v) : chip("neutral", "pending"));

  const I = {
    logo: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 28 10v12L16 29 4 22V10z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 10v13M10.5 13.5 16 17l5.5-3.5" fill="none" stroke="#b8f36b" stroke-width="1.8"/><circle cx="16" cy="9.5" r="1.6" fill="#b8f36b"/></svg>`,
    command: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="2.5" width="6" height="6"/><rect x="11.5" y="2.5" width="6" height="9"/><rect x="2.5" y="11.5" width="6" height="6"/><rect x="11.5" y="14.5" width="6" height="3"/></svg>`,
    diplomacy: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4" cy="10" r="2"/><circle cx="16" cy="4.5" r="2"/><circle cx="16" cy="15.5" r="2"/><path d="M5.8 9.1 14.2 5.4M5.8 10.9l8.4 3.7M16 6.5v7"/></svg>`,
    enclave: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2 17 6v8l-7 4-7-4V6z"/><path d="M10 10v8M3 6l7 4 7-4"/></svg>`,
    treaty: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 2.5h7l3.5 3.5v11.5H5z"/><path d="M12 2.5V6h3.5M7.5 10h5M7.5 13h5"/></svg>`,
    tribunal: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 7 10 3l7.5 4M4 7.5v7M8 7.5v7M12 7.5v7M16 7.5v7M2.5 17.5h15"/></svg>`,
    sim: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="3.5"/><path d="M10 1v4M10 15v4M1 10h4M15 10h4"/></svg>`,
    events: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5h14M3 10h14M3 15.5h9"/><circle cx="16" cy="15.5" r="1.5"/></svg>`,
    lock: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="7" y="14" width="18" height="13" rx="1.5"/><path d="M11 14V10a5 5 0 0 1 10 0v4M16 19v3"/></svg>`,
    seal: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="16" cy="13" r="8"/><path d="M12.5 13l2.5 2.5 4.5-5M11 19.5 9 29l7-3.5 7 3.5-2-9.5"/></svg>`,
    shield: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 3 26 7v8c0 7-4.5 11.5-10 14-5.5-2.5-10-7-10-14V7z"/><path d="M11.5 16l3 3 6-6.5"/></svg>`,
    menu: `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 5h14M3 10h14M3 15h14"/></svg>`,
    play: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11L13 8z"/></svg>`,
    pause: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>`,
    step: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 2.5v11L10 8zM11 2.5h2v11h-2z"/></svg>`,
    end: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5v11L7.5 8zM8 2.5v11L13.5 8zM13.5 2.5h1.5v11h-1.5z"/></svg>`,
    reset: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5V5h2.5"/></svg>`,
    empty: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M24 4 42 14v20L24 44 6 34V14z"/><path d="M24 24v20M6 14l18 10 18-10"/></svg>`,
  };

  // ---------------------------------------------------------------- state
  const params = new URLSearchParams(location.search);
  const S = {
    mode: params.get("mode") === "demo" ? "demo" : "live",
    contract: params.get("contract") || DEFAULT_CONTRACT,
    model: null, loading: true, error: null,
    net: { ok: null, height: null },
    demo: null,
  };

  // ---------------------------------------------------------------- data
  async function rpc(method, params) {
    const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "pactum", method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.cause?.name || j.error.message || "RPC error");
    if (j.result?.error) throw new Error(j.result.error);
    return j.result;
  }
  const view = async (m, a = {}) => {
    const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: S.contract, method_name: m, args_base64: btoa(JSON.stringify(a)) });
    return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
  };
  async function pingNet() {
    try { const b = await rpc("block", { finality: "final" }); S.net = { ok: true, height: b.header.height }; }
    catch { S.net = { ok: false, height: null }; }
    $$("[data-netstat]").forEach((n) => (n.innerHTML = netstat()));
  }
  const netstat = () => S.net.ok === null ? `<span class="netstat"><span class="dot" style="color:var(--mute)"></span>NEAR testnet</span>`
    : S.net.ok ? `<span class="netstat" title="Latest final block from ${RPC}"><span class="dot live" style="color:var(--emerald)"></span>testnet · #${S.net.height.toLocaleString()}</span>`
    : `<span class="netstat"><span class="dot" style="color:var(--fail)"></span>testnet unreachable</span>`;

  async function loadDemoFile() {
    if (!S.demo) S.demo = await (await fetch("data/demo-data.json")).json();
    return S.demo;
  }

  function demoModel(d) {
    const tl = d.timeline;
    const snap = tl.find((e) => e.type === "snapshot").snapshot;
    const intro = tl.find((e) => e.type === "intro");
    const reg = Object.fromEntries(tl.filter((e) => e.type === "enclave_registered").map((e) => [e.enclave, e]));
    const ratified = Object.fromEntries(tl.filter((e) => e.type === "treaty_ratified").map((e) => [e.treaty.id, e.treaty]));
    const filed = Object.fromEntries(tl.filter((e) => e.type === "dispute_filed").map((e) => [e.dispute.id, e]));
    const votes = {};
    tl.filter((e) => e.type === "judge_vote").forEach((e) => (votes[e.dispute] ||= []).push({ judge_id: e.judge, verdict: e.verdict, metric_bps: e.metric_bps, signature: e.signature, mode: e.mode, rationale: e.text }));
    const rulings = Object.fromEntries(tl.filter((e) => e.type === "ruling").map((e) => [e.dispute, e]));
    return {
      mode: "demo", source: `simulation · ${d.contract}`, contract: d.contract, generated: d.generated,
      enclaves: snap.enclaves.map((e) => ({ account: e.account, name: e.name, chain: e.chain, payout: reg[e.account] ? null : null, free: +e.free, locked: +e.locked, frozen: e.frozen, score: e.score, rep: e.rep, created: null, beneficiary: null })),
      treaties: snap.treaties.map((t) => ({ id: t.id, a: t.a, b: t.b, status: t.status, bond_a: +t.bond_a, bond_b: +t.bond_b, terms: null, terms_hash: ratified[t.id]?.terms_hash || null, params: ratified[t.id]?.params || {}, created: null, duration: null })),
      disputes: snap.disputes.map((x) => ({ ...x, allegation: (filed[x.id]?.text.match(/"(.*)"/) || [])[1] || "", evidence_sha256: filed[x.id]?.dispute.evidence_sha256, evidence_uri: null, filed: null, rationale: rulings[x.id]?.text, votes: votes[x.id] || [], judges: rulings[x.id]?.judges || [] })),
      judges: intro.judges.map((j) => ({ id: j.id, name: j.name, model: j.model, signing_address: j.signing_address, attestation_sha256: j.attestation_sha256, active: j.active, simulated: true })),
      payouts: snap.payouts.map((p) => ({ ...p, amount: +p.amount, target: { chain: p.chain, address: p.address } })),
      audit: { liabilities: +snap.liabilities, solvent: null },
      refusals: tl.filter((e) => e.type === "rob_attempt").map((e) => ({ rule: e.rule, attack: e.text.replace(/ -> REFUSED.*/, "").replace(/^R-ROB-\S+ /, ""), message: e.refusal, actor: e.who, tx: null })),
      events: tl.filter((e) => !["snapshot", "intro"].includes(e.type)).map((e) => demoEvent(e)),
      tx: {},
    };
  }
  const DEMO_LABEL = { intents_quote: "Funding leg", enclave_registered: "Enclave registered", policy: "Policy set", offer: "Negotiation offer", treaty_ratified: "Treaty activated", rob_attempt: "Attack rejected", dispute_filed: "Dispute filed", judge_vote: "Judge evaluation", ruling: "Ruling verified", payout: "Enforcement payout", treaty_state: "Treaty state", frozen: "Enclave frozen" };
  const EV_CLS = { "Attack rejected": "fail", "Dispute filed": "dispute", "Ruling verified": "gold", "Judge evaluation": "gold", "Enforcement payout": "em", "Chain Signatures": "em", "Treaty activated": "ok", "Enclave frozen": "warn" };
  function demoEvent(e) {
    const type = DEMO_LABEL[e.type] || e.type;
    const actor = e.enclave || e.from || e.who || e.dispute?.plaintiff || e.treaty?.a || (e.judge !== undefined ? `judge ${e.judge}` : "");
    return { seq: e.t, type, actor: actor ? short(actor) : "", text: e.text, status: e.type === "rob_attempt" ? "refused" : "", tx: null, raw: e };
  }

  async function liveModel() {
    const [enc, trs, dis, jud, pay, audit] = await Promise.all([
      view("list_enclaves", { from: 0, limit: 200 }), view("list_treaties", { from: 0, limit: 500 }), view("list_disputes", { from: 0, limit: 500 }),
      view("list_judges"), view("list_payouts", { from: 0, limit: 500 }), view("audit"),
    ]);
    // Recorded runs (real tx hashes), used only when they belong to this contract.
    const runs = [];
    for (const f of ["data/testnet-evidence.json", "data/testnet-real-judges.json"]) {
      try { const e = await (await fetch(f)).json(); if (e.contract === S.contract) runs.push(e); } catch { /* optional */ }
    }
    const ev = runs[0] || null;
    const items = runs.flatMap((r) => r.items);
    const tx = {};
    // Per-dispute / per-treaty tx references: each run's file_dispute / submit_verdicts belong to the dispute it resolved.
    const dtx = {}, ttx = {};
    runs.forEach((r, ri) => {
      const h = (s) => r.items.find((i) => i.step === s)?.hash;
      const fd = r.items.find((i) => i.step === "final dispute")?.dispute;
      const did = fd ? fd.id : ri === 0 ? 0 : null, tid = fd ? fd.treaty_id : ri === 0 ? 0 : null;
      if (did != null) dtx[did] = { file: h("file_dispute (meta-tx)"), verdict: h("submit_verdicts"), sign: h("Chain Signatures sign()") };
      if (tid != null) ttx[tid] = { propose: h("propose_treaty (meta-tx)"), ratify: h("ratify (meta-tx)") };
      r.items.forEach((i) => i.hash && !(i.step in tx) && (tx[i.step] = i.hash));
    });
    const liveVotes = {};
    items.filter((i) => i.votes).flatMap((i) => i.votes).forEach((v) => {
      try {
        const id = Number((v.request_body.match(/pactum:v1\|[^|]+\|(\d+)\|/) || [])[1]);
        const c = JSON.parse(v.response_body).choices[0].message.content;
        const p = JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
        (liveVotes[id] ||= []).push({ judge_id: v.judge_id, verdict: p.verdict, metric_bps: p.metric_bps, rationale: p.rationale, signature: v.signature, mode: v.mode, response_body: v.response_body, request_body: v.request_body });
      } catch { /* skip malformed */ }
    });
    const enclaves = enc.map(({ enclave: e, score }) => ({ account: e.account, name: e.name, chain: e.payout.chain, payoutAddress: e.payout.address, beneficiary: e.beneficiary, free: yocto(e.free), locked: yocto(e.locked), frozen: e.frozen, score, rep: e.rep, maxBond: e.max_bond ? yocto(e.max_bond) : null, guardian: e.guardian, created: nsDate(e.created_ns), active: e.active }));
    const treaties = trs.map((t) => ({ id: t.id, a: t.party_a, b: t.party_b, status: t.status, bond_a: yocto(t.bond_a), bond_b: yocto(t.bond_b), terms: t.terms, terms_hash: t.terms_hash, params: t.params || {}, telemetry: t.telemetry_urls || [], created: nsDate(t.created_ns), activated: nsDate(t.activated_ns), duration: Number(t.duration_ns) / 864e11, open_dispute: t.open_dispute, elevated_a: t.elevated_a, elevated_b: t.elevated_b }));
    const disputes = dis.map((d) => ({ id: d.id, treaty_id: d.treaty_id, plaintiff: d.plaintiff, defendant: d.defendant, allegation: d.allegation, evidence_uri: d.evidence_uri, evidence_sha256: d.evidence_sha256, bond: yocto(d.bond), filed: nsDate(d.filed_ns), status: d.status, raw: wire(d.raw_verdict), verdict: wire(d.verdict), metric_bps: d.metric_bps, rationale: d.rationale, judges: d.judges, vote_hashes: d.vote_hashes || [], votes: liveVotes[d.id] || [] }));
    const judges = jud.map((j) => ({ id: j.id, name: `Judge ${j.id}`, model: j.model, signing_address: j.signing_address, attestation_sha256: j.attestation_sha256, kind: j.kind, active: j.active, simulated: String(j.model).startsWith("sim/") }));
    const payouts = pay.map((p) => ({ id: p.id, dispute_id: p.dispute_id, to: p.beneficiary_enclave, target: p.target, amount: yocto(p.amount), status: p.status, path: p.path, mpc_signature: p.mpc_signature, dest_tx: p.dest_tx }));
    const refusals = items.filter((i) => /^R-ROB/.test(i.step)).map((i) => ({ rule: i.step.split(" ")[0], attack: i.step.replace(/^R-ROB-\S+ /, ""), message: refusalMsg(i.error), proves: i.proves, tx: i.hash || null, onchain: !!i.hash }));
    const events = [];
    if (runs.length) {
      items.filter((i) => i.hash || i.votes).forEach((i, k) => events.push({ seq: k, type: liveType(i.step), actor: liveActor(i.step), text: i.proves ? `${i.step}: ${i.proves}` : i.step, status: i.ok ? "ok" : "refused", tx: i.hash || null, detail: i.error ? refusalMsg(i.error) : null }));
    } else {
      enclaves.forEach((e) => events.push({ seq: 0, type: "Enclave registered", actor: e.name, text: `Enclave ${e.account}`, status: "ok", tx: null, date: e.created }));
      treaties.forEach((t) => events.push({ seq: 1, type: "Treaty activated", actor: short(t.a), text: `Treaty #${t.id} ${short(t.a)} ↔ ${short(t.b)} (${t.status})`, status: t.status, tx: null, date: t.activated || t.created }));
      disputes.forEach((d) => { events.push({ seq: 2, type: "Dispute filed", actor: short(d.plaintiff), text: `Dispute #${d.id}: ${d.allegation}`, status: d.status, tx: null, date: d.filed }); if (d.verdict) events.push({ seq: 3, type: "Ruling verified", actor: "tribunal", text: `Ruling #${d.id}: ${d.verdict}`, status: "ok", tx: null }); });
    }
    return { mode: "live", source: `testnet · ${S.contract}`, contract: S.contract, evidence: ev, enclaves, treaties, disputes, judges, payouts, audit: { liabilities: yocto(audit.liabilities), solvent: audit.solvent, balance: yocto(audit.balance) }, refusals, events, tx, dtx, ttx };
  }
  const refusalMsg = (err) => {
    if (!err) return "";
    const m = String(err).match(/"ExecutionError":"Smart contract panicked: ([^"]+)"/); if (m) return m[1];
    const k = String(err).match(/DelegateActionAccessKeyError":(\{"([A-Za-z]+)"|"([A-Za-z]+)")/); if (k) return `runtime: ${k[2] || k[3]}`;
    return String(err).slice(0, 140);
  };
  const liveType = (s) => /^R-ROB/.test(s) ? "Attack rejected" : /register (TEE )?(judge|node)/.test(s) ? "Judge registered" : /deactivate/.test(s) ? "Judge deactivated" : /register enclave/.test(s) ? "Enclave registered" : /propose_treaty/.test(s) ? "Treaty proposed"
    : /ratify/.test(s) ? "Treaty activated" : /file_dispute/.test(s) ? "Dispute filed" : /judge votes/.test(s) ? "Judge evaluation" : /submit_verdicts/.test(s) ? "Ruling verified" : /Chain Signatures/.test(s) ? "Chain Signatures" : "Protocol";
  const liveActor = (s) => (s.match(/(atlas|meridian|mallory)/) || [])[1] || (/(propose|file_dispute)/.test(s) ? "atlas" : /ratify/.test(s) ? "meridian" : /verdict|judge/.test(s) ? "tribunal" : "owner");

  async function load() {
    S.loading = true; S.error = null; render();
    try { S.model = S.mode === "demo" ? demoModel(await loadDemoFile()) : await liveModel(); }
    catch (e) { S.error = e.message; S.model = null; }
    S.loading = false; render();
  }

  function setMode(mode) {
    S.mode = mode;
    const p = new URLSearchParams(location.search);
    if (mode === "demo") p.set("mode", "demo"); else p.delete("mode");
    history.replaceState(null, "", `${location.pathname}${p.toString() ? "?" + p : ""}${location.hash}`);
    load();
  }

  // ---------------------------------------------------------------- drawer
  let lastFocus = null;
  function openDrawer(kicker, title, html, gold) {
    lastFocus = document.activeElement;
    $("#drawer-kicker").textContent = kicker; $("#drawer-kicker").style.color = gold ? "var(--gold)" : "";
    $("#drawer-title").textContent = title; $("#drawer-body").innerHTML = html;
    const d = $("#drawer"), s = $("#scrim");
    d.hidden = false; s.classList.remove("hidden");
    requestAnimationFrame(() => { d.classList.add("open"); s.classList.add("open"); $("#drawer-x").focus(); });
    bindRefs($("#drawer-body"));
  }
  function closeDrawer() {
    const d = $("#drawer"), s = $("#scrim");
    d.classList.remove("open"); s.classList.remove("open");
    setTimeout(() => { d.hidden = true; s.classList.add("hidden"); }, reduceMotion ? 0 : 260);
    lastFocus?.focus?.();
  }
  $("#drawer-x").onclick = closeDrawer; $("#scrim").onclick = closeDrawer;
  addEventListener("keydown", (e) => e.key === "Escape" && !$("#drawer").hidden && closeDrawer());

  // data-open="enclave:<acct>" | "treaty:<id>" | "dispute:<id>" | "event:<idx>"
  function bindRefs(root) {
    $$("[data-open]", root).forEach((el) => {
      const go = (ev) => { if (ev.target.closest("a")) return; const [k, v] = el.dataset.open.split(/:(.*)/); ({ enclave: enclaveDrawer, treaty: treatyDrawer, dispute: disputeDrawer, event: eventDrawer }[k])?.(v); };
      el.addEventListener("click", go);
      if (!/^(A|BUTTON)$/.test(el.tagName)) { el.tabIndex = 0; el.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), go(e))); }
    });
  }

  // ---------------------------------------------------------------- shared pieces
  const M = () => S.model;
  const enclaveOf = (a) => M().enclaves.find((e) => e.account === a);
  const treatiesOf = (a) => M().treaties.filter((t) => t.a === a || t.b === a);
  const disputesOf = (tid) => M().disputes.filter((d) => d.treaty_id === tid);
  const modeBadge = () => (S.mode === "live" ? `<span class="mode-badge live">LIVE · TESTNET</span>` : `<span class="mode-badge demo">DEMO DATA · SIMULATION</span>`);

  function enclaveDrawer(acct) {
    const e = enclaveOf(acct); if (!e) return;
    const trs = treatiesOf(acct);
    const evs = M().events.filter((x) => x.actor === e.name).slice(0, 12);
    openDrawer("Sovereign enclave", e.name, `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${e.frozen ? chip("fail", "frozen by guardian", 1) : chip("ok", "active", 1)}${chip("neutral", `payout · ${e.chain}`)}${modeBadge()}</div>
      <dl class="kv">
        <dt>Account</dt><dd>${S.mode === "live" ? acctLink(e.account) : `<span class="mono">${esc(e.account)}</span>`}</dd>
        <dt>Free collateral</dt><dd>${near(e.free)} NEAR</dd>
        <dt>Bonded in escrow</dt><dd>${near(e.locked)} NEAR</dd>
        <dt>Trust score</dt><dd>${e.score} / 1000 <span class="mute">(on-chain reputation formula, RULES S-7)</span></dd>
        ${e.payoutAddress ? `<dt>Payout target</dt><dd class="mono">${esc(e.chain)}:${esc(e.payoutAddress)}</dd>` : ""}
        ${e.beneficiary ? `<dt>Beneficiary</dt><dd class="mono">${esc(e.beneficiary)}</dd>` : ""}
        ${e.maxBond != null ? `<dt>Self-imposed cap</dt><dd>${near(e.maxBond)} NEAR</dd>` : ""}
        ${e.guardian ? `<dt>Guardian</dt><dd class="mono">${esc(e.guardian)}</dd>` : ""}
        ${e.created ? `<dt>Registered</dt><dd>${fmtDate(e.created)}</dd>` : ""}
        <dt>Key policy</dt><dd>Function-call key only · 7 Pactum methods · 0.25 NEAR gas allowance</dd>
      </dl>
      ${e.rep ? `<div class="block"><h4 class="label">Reputation record</h4><dl class="kv">${Object.entries(e.rep).map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${v}</dd>`).join("")}</dl></div>` : ""}
      <div class="block"><h4 class="label">Treaties (${trs.length})</h4>${trs.length ? trs.map((t) => `<div class="ev" data-open="treaty:${t.id}" style="grid-template-columns:auto minmax(0,1fr) auto;padding:10px 0"><span class="mono">#${t.id}</span><span>${esc(short(t.a))} ↔ ${esc(short(t.b))}</span>${chip(STATUS[t.status] || "neutral", t.status)}</div>`).join("") : `<p class="dim">No treaties.</p>`}</div>
      ${evs.length ? `<div class="block"><h4 class="label">Recent events</h4>${evs.map((x) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="label">${esc(x.type)}</span><div>${esc(x.text)}</div>${x.tx ? txLink(x.tx) : ""}</div>`).join("")}</div>` : ""}
      <p class="mute" style="margin-top:22px;font-size:12px">Actions on an enclave are taken by its agent runtime with its own function-call key (meta transactions). To act yourself, connect a testnet wallet under <a href="#/verify">Verify → Rob it yourself</a>.</p>`);
  }

  function treatyDrawer(id) {
    const t = M().treaties.find((x) => String(x.id) === String(id)); if (!t) return;
    const ds = disputesOf(t.id);
    const tx = M().tx;
    openDrawer(`Treaty record · #${t.id}`, `${short(t.a)} ↔ ${short(t.b)}`, `
      <div class="record">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span class="label">Sovereign agreement</span>${chip(STATUS[t.status] || "neutral", t.status, 1)}</div>
        ${t.terms ? `<div class="terms">${esc(t.terms)}</div>` : `<p class="dim" style="margin:14px 0">Full text is held on-chain; the demo record carries only its hash.</p>`}
        <dl class="kv">
          <dt>Terms hash</dt><dd class="mono break">${esc(t.terms_hash || "—")}</dd>
          <dt>Party A</dt><dd class="mono" data-open="enclave:${esc(t.a)}" style="cursor:pointer">${esc(t.a)}</dd>
          <dt>Party B</dt><dd class="mono" data-open="enclave:${esc(t.b)}" style="cursor:pointer">${esc(t.b)}</dd>
          <dt>Escrow A / B</dt><dd>${near(t.bond_a)} / ${near(t.bond_b)} NEAR</dd>
          ${Object.keys(t.params || {}).length ? `<dt>Parameters</dt><dd class="mono">${Object.entries(t.params).map(([k, v]) => `${esc(k)} = ${esc(v)}`).join("<br>")}</dd>` : ""}
          ${t.duration ? `<dt>Duration</dt><dd>${near(t.duration)} days</dd>` : ""}
          ${t.created ? `<dt>Proposed</dt><dd>${fmtDate(t.created)}</dd>` : ""}
          ${t.activated ? `<dt>Activated</dt><dd>${fmtDate(t.activated)}</dd>` : ""}
          ${t.telemetry?.length ? `<dt>Telemetry</dt><dd class="mono">${t.telemetry.map(esc).join("<br>")}</dd>` : ""}
        </dl>
      </div>
      ${S.mode === "live" && M().ttx?.[t.id] ? `<div class="block"><h4 class="label">Transaction references</h4><dl class="kv"><dt>Proposed (meta-tx)</dt><dd>${txLink(M().ttx[t.id].propose)}</dd><dt>Ratified (meta-tx)</dt><dd>${txLink(M().ttx[t.id].ratify)}</dd></dl></div>` : ""}
      <div class="block"><h4 class="label">Disputes (${ds.length})</h4>${ds.length ? ds.map((d) => `<div class="ev" data-open="dispute:${d.id}" style="grid-template-columns:auto minmax(0,1fr) auto;padding:10px 0"><span class="mono">#${d.id}</span><span>${esc(short(d.plaintiff))} vs ${esc(short(d.defendant))}</span>${verdictChip(d.verdict)}</div>`).join("") : `<p class="dim">No disputes filed.</p>`}</div>`);
  }

  function stagesOf(d) {
    const tx = (M().dtx || {})[d.id] || {}, live = S.mode === "live";
    const pay = M().payouts.filter((p) => p.dispute_id === d.id);
    const t = M().treaties.find((x) => x.id === d.treaty_id);
    return [
      { done: true, t: "Dispute submitted", s: `Filed by ${short(d.plaintiff)} against ${short(d.defendant)}${d.filed ? ` · ${fmtDate(d.filed)}` : ""}`, tx: live && tx.file },
      { done: !!d.evidence_sha256, t: "Evidence committed", s: d.evidence_sha256 ? `sha256 ${shortHash(d.evidence_sha256, 16)}: judges must fetch bytes that hash to this` : "No evidence hash on record" },
      { done: d.votes.length > 0, t: "TEE judge evaluation", s: d.votes.length ? `${d.votes.length} signed votes recorded${d.votes.some((v) => v.mode === "simulation") ? " (simulated TEE keys)" : d.votes.some((v) => v.mode === "near-ai-cloud") ? " · NEAR AI Cloud TEE signatures" : ""}` : "Individual votes are not stored on-chain for this dispute" },
      { done: !!d.verdict, t: "Decision generated", s: d.verdict ? `${d.raw}${d.raw !== d.verdict ? ` → clamped to ${d.verdict}` : ""} · metric ${d.metric_bps} bps` : "Awaiting quorum" },
      { done: d.status === "Resolved", t: "Cryptographic verification", s: d.status === "Resolved" ? `Contract recovered ${d.judges.length} signer(s) with ecrecover and matched registered judge addresses (2-of-3 quorum)` : "Not yet verified", tx: live && d.status === "Resolved" && tx.verdict },
      { done: pay.length > 0 || t?.status === "Closed", t: "On-chain enforcement", s: pay.length ? pay.map((p) => `${near(p.amount)} NEAR → ${p.target.chain} (${p.status})`).join("; ") : t?.status === "Closed" ? "Treaty closed, bonds released" : d.verdict ? "No transfer required for this verdict" : "Pending", tx: live && pay.some((p) => p.status === "Signed") && tx.sign },
    ];
  }

  function rulingDoc(d, compact = false) {
    const j = M().judges;
    const st = stagesOf(d);
    return `<article class="ruling">
      <div class="hdr"><div><div class="label" style="color:var(--gold)">Pactum Tribunal · Ruling of record</div><h3>Dispute № ${d.id}</h3><div class="dim" style="margin-top:4px">${esc(short(d.plaintiff))} v. ${esc(short(d.defendant))} · Treaty #${d.treaty_id}</div></div>
        <svg class="seal" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width=".6" stroke-dasharray="2 3"/><path d="M50 22 74 36v28L50 78 26 64V36z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M50 36v28M38 43l12 7 12-7" fill="none" stroke="currentColor" stroke-width="1.6"/>${d.status === "Resolved" ? `<path d="M41 52l6 6 13-14" fill="none" stroke="currentColor" stroke-width="2.4" transform="translate(0 4)"/>` : ""}</svg></div>
      ${d.verdict ? `<div class="verdict" style="color:var(--${VERDICT[d.verdict]?.cls === "fail" ? "fail" : VERDICT[d.verdict]?.cls === "dispute" ? "dispute" : "gold"})">${esc(d.verdict.replace(/_/g, " "))}</div><div class="dim">${esc(VERDICT[d.verdict]?.label || "")} · objective shortfall ${d.metric_bps} bps</div>` : `<div class="verdict dim">PENDING</div>`}
      ${!compact && d.allegation ? `<div class="block"><div class="label">Allegation</div><p style="margin:6px 0 0;font-family:Georgia,serif;font-size:15px">“${esc(d.allegation)}”</p></div>` : ""}
      <div class="block"><div class="label">Adjudication record</div><ol class="stages">${st.map((s, i) => `<li class="${s.done ? "done" : "na"}"><span class="mk">${s.done ? "✓" : i + 1}</span><div><b>${esc(s.t)}</b><div class="dim" style="font-size:13px">${esc(s.s)}</div>${s.tx ? `<div style="margin-top:3px">${txLink(s.tx)}</div>` : ""}</div></li>`).join("")}</ol></div>
      ${!compact && d.votes.length ? `<div class="block"><div class="label">Signed votes</div><div class="grid" style="margin-top:8px">${d.votes.map((v) => `<div class="vote"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(j[v.judge_id]?.name || "Judge " + v.judge_id)}</b>${verdictChip(v.verdict)}</div><div class="mono dim" style="margin-top:4px">${esc(j[v.judge_id]?.model || "")} · signer 0x${esc((j[v.judge_id]?.signing_address || "").slice(0, 12))}…</div><div class="mono mute break" style="margin-top:6px">sig ${esc(String(v.signature).slice(0, 42))}…</div>${v.rationale ? `<div class="dim" style="margin-top:6px;font-size:12.5px">${esc(String(v.rationale).replace(/^\[simulation\] /, ""))}</div>` : ""}</div>`).join("")}</div></div>` : ""}
      ${!compact && d.vote_hashes?.length ? `<div class="block"><div class="label">On-chain vote commitments (sha256 of TEE response bodies)</div>${d.vote_hashes.map((h) => `<div class="mono break dim" style="margin-top:4px">${esc(h)}</div>`).join("")}</div>` : ""}
      ${d.status === "Resolved" ? `<div class="block verify">${I.seal.replace("<svg", '<svg width="18" height="18"')} Signatures recovered on-chain · quorum met${S.mode === "demo" ? " (simulation mirror)" : ""}</div>` : ""}
    </article>`;
  }
  function disputeDrawer(id) {
    const d = M().disputes.find((x) => String(x.id) === String(id)); if (!d) return;
    openDrawer("Tribunal · dispute record", `Dispute № ${d.id}`, `${rulingDoc(d)}
      <div class="block"><h4 class="label">Evidence</h4><dl class="kv"><dt>sha256</dt><dd class="mono break">${esc(d.evidence_sha256 || "—")}</dd>${d.evidence_uri ? `<dt>URI</dt><dd class="mono break">${esc(d.evidence_uri)}</dd>` : ""}${d.bond ? `<dt>Dispute bond</dt><dd>${near(d.bond)} NEAR</dd>` : ""}</dl></div>`, true);
  }
  function eventDrawer(i) {
    const e = M().events[+i]; if (!e) return;
    openDrawer(e.type, e.actor || "Protocol event", `<dl class="kv"><dt>Sequence</dt><dd class="mono">#${String(e.seq).padStart(2, "0")}</dd><dt>Actor</dt><dd>${esc(e.actor || "—")}</dd><dt>Status</dt><dd>${e.status ? chip(e.status === "refused" ? "fail" : STATUS[e.status] || "ok", e.status) : "—"}</dd><dt>Description</dt><dd>${esc(e.text)}</dd>${e.detail ? `<dt>Refusal</dt><dd class="mono">${esc(e.detail)}</dd>` : ""}<dt>Transaction</dt><dd>${e.tx ? txLink(e.tx, e.tx) : `<span class="mute">${S.mode === "demo" ? "simulation: no transaction" : "not recorded"}</span>`}</dd>${e.date ? `<dt>Time</dt><dd>${fmtDate(e.date)}</dd>` : ""}</dl>`);
  }

  // ---------------------------------------------------------------- topology
  function topology(root, { mini = false } = {}) {
    const m = M(); const W = 800, H = 520, cx = W / 2, cy = H / 2;
    const n = m.enclaves.length;
    const R = Math.min(200, 120 + n * 14);
    const pos = {};
    m.enclaves.forEach((e, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1); pos[e.account] = { x: cx + Math.cos(a) * R * 1.35, y: cy + Math.sin(a) * R }; });
    const col = (s) => ({ Active: "var(--emerald)", Proposed: "var(--warn)", Disputed: "var(--dispute)", Exiting: "var(--warn)" }[s] || "#6b7a71");
    const pair = {};
    const edges = m.treaties.filter((t) => pos[t.a] && pos[t.b]).map((t) => {
      const k = [t.a, t.b].sort().join("|"); const idx = (pair[k] = (pair[k] || 0) + 1) - 1;
      const A = pos[t.a], B = pos[t.b]; const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const dx = B.y - A.y, dy = A.x - B.x, len = Math.hypot(dx, dy) || 1, off = (idx % 2 ? -1 : 1) * Math.ceil(idx / 2) * 34;
      const qx = mx + (dx / len) * off + (cx - mx) * 0.18, qy = my + (dy / len) * off + (cy - my) * 0.18;
      const d = `M${A.x},${A.y} Q${qx},${qy} ${B.x},${B.y}`;
      const dashed = t.status === "Proposed" ? ' stroke-dasharray="6 6"' : t.status === "Closed" ? ' stroke-dasharray="2 6"' : "";
      return `<g class="edge-g" data-open="treaty:${t.id}" data-tip="Treaty #${t.id} · ${esc(short(t.a))} ↔ ${esc(short(t.b))}|${esc(t.status)} · escrow ${near(t.bond_a + t.bond_b)} NEAR"><path class="edge-hit" d="${d}" fill="none"/><path class="edge" d="${d}" fill="none" stroke="${col(t.status)}"${dashed} opacity="${t.status === "Closed" ? 0.6 : 0.95}"/>${t.status === "Active" && !reduceMotion ? `<path d="${d}" fill="none" stroke="#e9ffd0" stroke-width="1.4" class="flow" opacity=".55"/>` : ""}</g>`;
    }).join("");
    const nodes = m.enclaves.map((e) => {
      const p = pos[e.account]; const c = CHAIN[e.chain] || "#a6aea8";
      return `<g class="node" data-open="enclave:${esc(e.account)}" data-tip="${esc(e.account)}|trust ${e.score} · escrow ${near(e.locked)} · free ${near(e.free)} NEAR${e.frozen ? " · FROZEN" : ""}" transform="translate(${p.x},${p.y})">
        <polygon points="0,-34 29,-17 29,17 0,34 -29,17 -29,-17" fill="#121a16" stroke="${e.frozen ? "var(--fail)" : "#2f3d35"}" stroke-width="1.2"/>
        <polygon class="ring" points="0,-26 22.5,-13 22.5,13 0,26 -22.5,13 -22.5,-13" fill="none" stroke="${c}" stroke-width="1.6"/>
        <text y="-1" text-anchor="middle" fill="#f3f5f1" font-family="Space Grotesk" font-weight="600" font-size="13">${esc(e.name)}</text>
        <text y="13" text-anchor="middle" fill="${c}" font-family="JetBrains Mono" font-size="8.5" letter-spacing=".08em">${esc(e.chain.toUpperCase())}</text>
        ${mini ? "" : `<text y="52" text-anchor="middle" fill="#6f7a73" font-family="JetBrains Mono" font-size="9.5">trust ${e.score} · ${near(e.locked)} bonded</text>`}</g>`;
    }).join("");
    const core = `<g aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="70" fill="url(#coreGlow)"/><polygon points="${cx},${cy - 36} ${cx + 31},${cy - 18} ${cx + 31},${cy + 18} ${cx},${cy + 36} ${cx - 31},${cy + 18} ${cx - 31},${cy - 18}" fill="#0f1612" stroke="#3a4a40"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#b8f36b" font-family="Space Grotesk" font-weight="700" font-size="11" letter-spacing=".2em">PACTUM</text></g>`;
    root.innerHTML = `<div class="topo-wrap">${mini ? "" : `<div class="topo-tools"><button data-z="1.2" aria-label="Zoom in">+</button><button data-z="0.83" aria-label="Zoom out">−</button><button data-z="0" aria-label="Reset view">⟲</button></div>`}
      <svg class="topo" viewBox="0 0 ${W} ${H}" role="img" aria-label="Network of ${n} enclaves and ${m.treaties.length} treaties" ${mini ? 'style="height:auto;aspect-ratio:800/520"' : ""}>
        <defs><radialGradient id="coreGlow"><stop offset="0" stop-color="#79c84a" stop-opacity=".28"/><stop offset="1" stop-color="#79c84a" stop-opacity="0"/></radialGradient></defs>
        <g class="vp">${core}${edges}${nodes}</g></svg>
      ${mini ? "" : `<div class="topo-legend"><span style="--c:var(--emerald)">active treaty</span><span style="--c:var(--warn)">proposed</span><span style="--c:var(--dispute)">disputed</span><span style="--c:#6b7a71">closed</span><span class="mute">Hover to inspect · click to open · drag to pan · wheel to zoom</span></div>`}</div>`;
    if (!n) root.querySelector(".vp").innerHTML += `<text x="${cx}" y="${cy + 70}" text-anchor="middle" fill="#6f7a73" font-size="13">No enclaves registered on this contract yet.</text>`;
    bindRefs(root);
    const tip = $("#tip");
    $$("[data-tip]", root).forEach((g) => {
      g.addEventListener("pointermove", (ev) => { const [a, b] = g.dataset.tip.split("|"); tip.innerHTML = `<b>${a}</b><div class="dim">${b}</div>`; tip.classList.remove("hidden"); tip.style.left = Math.min(ev.clientX + 14, innerWidth - 270) + "px"; tip.style.top = ev.clientY + 14 + "px"; tip.style.position = "fixed"; });
      g.addEventListener("pointerleave", () => tip.classList.add("hidden"));
    });
    if (mini) return;
    // zoom + pan via viewBox
    const svg = root.querySelector("svg"); let vb = [0, 0, W, H];
    const apply = () => svg.setAttribute("viewBox", vb.map((v) => v.toFixed(1)).join(" "));
    const zoom = (f, px = W / 2, py = H / 2) => { const nw = Math.min(W * 2, Math.max(W / 3, vb[2] / f)); const nh = (nw * H) / W; vb = [px - ((px - vb[0]) * nw) / vb[2], py - ((py - vb[1]) * nh) / vb[3], nw, nh]; apply(); };
    $$("[data-z]", root).forEach((b) => (b.onclick = () => (+b.dataset.z ? zoom(+b.dataset.z) : ((vb = [0, 0, W, H]), apply()))));
    svg.addEventListener("wheel", (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.12 : 0.89, vb[0] + ((e.clientX - r.left) / r.width) * vb[2], vb[1] + ((e.clientY - r.top) / r.height) * vb[3]); }, { passive: false });
    let drag = null;
    svg.addEventListener("pointerdown", (e) => { if (e.target.closest("[data-open]")) return; drag = { x: e.clientX, y: e.clientY, vb: [...vb] }; svg.classList.add("dragging"); svg.setPointerCapture(e.pointerId); });
    svg.addEventListener("pointermove", (e) => { if (!drag) return; const r = svg.getBoundingClientRect(); vb[0] = drag.vb[0] - ((e.clientX - drag.x) / r.width) * vb[2]; vb[1] = drag.vb[1] - ((e.clientY - drag.y) / r.height) * vb[3]; apply(); });
    svg.addEventListener("pointerup", () => { drag = null; svg.classList.remove("dragging"); });
  }

  // ---------------------------------------------------------------- landing
  const heroArt = `<svg class="hero-art" viewBox="0 0 640 560" role="img" aria-label="A suspended geometric monument above an architectural platform">
    <defs>
      <linearGradient id="hTop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a3530"/><stop offset="1" stop-color="#151c18"/></linearGradient>
      <linearGradient id="hL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2420"/><stop offset="1" stop-color="#0c110f"/></linearGradient>
      <linearGradient id="hR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26322c"/><stop offset="1" stop-color="#101613"/></linearGradient>
      <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8f36b" stop-opacity=".0"/><stop offset=".55" stop-color="#b8f36b" stop-opacity=".22"/><stop offset="1" stop-color="#b8f36b" stop-opacity="0"/></linearGradient>
      <radialGradient id="pool" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#79c84a" stop-opacity=".35"/><stop offset="1" stop-color="#79c84a" stop-opacity="0"/></radialGradient>
      <linearGradient id="plat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18201c"/><stop offset="1" stop-color="#090d0c"/></linearGradient>
    </defs>
    <g stroke="#1c2520" stroke-width="1" opacity=".9">${Array.from({ length: 9 }, (_, i) => `<line x1="${320 - 300 + i * 75}" y1="560" x2="320" y2="300"/>`).join("")}${Array.from({ length: 6 }, (_, i) => { const y = 400 + i * i * 6.5; const w = 120 + i * i * 22; return `<line x1="${320 - w}" y1="${y}" x2="${320 + w}" y2="${y}"/>`; }).join("")}</g>
    <path d="M40 470 320 390 600 470 320 552z" fill="url(#plat)" stroke="#2a3630"/>
    <path d="M40 470v14l280 82v-14zM600 470v14L320 566v-14z" fill="#0b100e" stroke="#202a25"/>
    <ellipse cx="320" cy="468" rx="190" ry="44" fill="url(#pool)"/>
    <path d="M300 160h40v300h-40z" fill="url(#beam)" opacity=".9"/>
    <g class="mono-float">
      <path d="M320 70 452 146 320 222 188 146z" fill="url(#hTop)" stroke="#3b4a42"/>
      <path d="M188 146 320 222v150L188 296z" fill="url(#hL)" stroke="#2c3832"/>
      <path d="M452 146 320 222v150l132-76z" fill="url(#hR)" stroke="#33413a"/>
      <path d="M320 222v150" stroke="#b8f36b" stroke-opacity=".7"/>
      <path d="M254 184v148M386 184v148" stroke="#b8f36b" stroke-opacity=".18"/>
      <path d="M320 104 400 150 320 196 240 150z" fill="none" stroke="#b8f36b" stroke-opacity=".45"/>
      <circle cx="320" cy="150" r="4" fill="#b8f36b"/>
    </g>
    <g fill="none" stroke="#a6aea8" stroke-opacity=".22"><path d="M188 296 120 340M452 296l68 44M320 372v40"/></g>
    <g font-family="JetBrains Mono" font-size="10" fill="#6f7a73" letter-spacing=".1em"><text x="470" y="96">ENCLAVE · ESCROW · COURT</text><text x="60" y="250">TEE ATTESTED</text><text x="476" y="330">CHAIN SIGNATURES</text></g>
  </svg>`;

  function landing() {
    const m = M();
    const proof = m && m.mode === "live" ? `<div class="hero-proof"><div><b>${m.enclaves.length}</b><span class="mute">enclaves on testnet</span></div><div><b>${m.refusals.filter((r) => r.onchain).length}</b><span class="mute">attacks refused on-chain</span></div><div><b>${m.disputes.filter((d) => d.status === "Resolved").length}</b><span class="mute">rulings verified on-chain</span></div></div>` : "";
    return `<div class="landing view-enter">
      <nav class="lnav" aria-label="Primary"><a class="brand" href="#/">${I.logo}PACTUM</a>
        <div class="links"><a href="#/verify" style="color:var(--emerald)">Verify</a><a href="#protocol">Protocol</a><a href="#/diplomacy">Network</a><a href="#/tribunal">Tribunal</a><a href="${REPO}#readme" target="_blank" rel="noopener">Documentation</a></div>
        <div class="right"><span data-netstat>${netstat()}</span><a class="btn primary" href="#/command">ENTER COMMAND</a><button class="menu-btn" id="lmenu" aria-label="Open menu" aria-expanded="false">${I.menu}</button></div></nav>
      <div class="mobile-menu" id="lmenu-panel"><a href="#/verify" style="color:var(--emerald);font-weight:600">Verify in 3 minutes →</a><a href="#/command">Enter command</a><a href="#protocol">Protocol</a><a href="#/diplomacy">Network</a><a href="#/tribunal">Tribunal</a><a href="${REPO}#readme" target="_blank" rel="noopener">Documentation</a><span style="padding:10px 4px" data-netstat>${netstat()}</span></div>
      <header class="hero"><div>
          <span class="kicker label"><span class="dot" style="color:var(--emerald)"></span>Built on NEAR · Testnet</span>
          <h1>SOVEREIGN<br>DIGITAL <em>DIPLOMACY.</em></h1>
          <p class="lead">The infrastructure for autonomous agents to negotiate, bond, adjudicate and enforce agreements through cryptographic trust.</p>
          <div class="ctas"><a class="btn primary" href="#/verify">VERIFY IN 3 MINUTES</a><a class="btn" href="#/command">ENTER COMMAND</a><a class="btn ghost" href="#protocol">EXPLORE PROTOCOL</a></div><p class="mute" style="margin-top:12px;font-size:13px">Judges: try to rob a treaty and watch the chain refuse it, fetched live from NEAR testnet. No wallet needed.</p>${proof}
        </div><div>${heroArt}</div></header>
      <section class="sec" id="protocol"><span class="label">Core capabilities</span><h2>An institution, not an app.</h2><p class="intro">Every agent gets a sovereign identity it cannot drain, every agreement is backed by escrow, and every dispute ends in a verifiable ruling enforced by the contract itself.</p>
        <div class="caps">
          <div class="cap">${I.enclave.replace('viewBox="0 0 20 20"', 'viewBox="0 0 20 20" width="30" height="30"')}<h3>Sovereign Enclaves</h3><p>Each agent is a NEAR sub-account created by the protocol, holding only a function-call key: seven methods, a 0.25 NEAR gas allowance, no transfers.</p></div>
          <div class="cap">${I.lock}<h3>Bonded Treaties</h3><p>Natural-language terms, hashed on-chain. Both sides move collateral from free balance into escrow before a treaty becomes active.</p></div>
          <div class="cap">${I.seal}<h3>TEE-Signed Rulings</h3><p>Judges reason inside NEAR AI Cloud TEEs. The contract recovers each signature with <span class="mono">ecrecover</span> and needs two of three to agree.</p></div>
          <div class="cap">${I.shield}<h3>On-Chain Enforcement</h3><p>Slashing, release or forfeit happens in the same transaction as the ruling. Payouts on other chains are signed by Chain Signatures.</p></div>
        </div></section>
      <section class="sec"><span class="label">Protocol lifecycle</span><h2>Five stages. One record.</h2>
        <div class="lifecycle">${[["Agent identities", "register_enclave creates a sub-account with a scoped key and credits collateral.", "Sub-accounts · function-call keys"], ["Treaty formation", "Agents negotiate, propose and ratify the exact terms hash, gaslessly.", "Meta transactions (NEP-366)"], ["Bonded escrow", "Bonds move free → locked. Locked funds cannot be withdrawn by anyone.", "Escrow ledger · audit()"], ["Dispute adjudication", "Hash-bound evidence; three TEE judges; 2-of-3 signatures recovered on-chain.", "NEAR AI Cloud · ecrecover"], ["Enforcement", "Slash, release or forfeit; cross-chain payouts signed by the MPC network.", "Chain Signatures · NEAR Intents"]].map(([t, p, k], i) => `<div class="lc"><span class="n">0${i + 1}</span><div class="bar"></div><h4>${t}</h4><p>${p}</p><div class="kit">${k}</div></div>`).join("")}</div></section>
      <section class="sec"><div class="split"><div><span class="label">The network</span><h2>A live map of sovereign relationships.</h2><p class="intro">Read straight from the Pactum contract on NEAR testnet: enclaves, treaties and their status. ${m && m.mode === "live" ? `Currently ${m.enclaves.length} enclaves and ${m.treaties.length} treaty on <span class="mono">${esc(m.contract)}</span>.` : ""}</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:20px"><a class="btn" href="#/diplomacy">Open the network →</a><a class="btn ghost" href="#/markets">Bonded Markets →</a></div></div>
        <div class="preview-frame" id="land-topo">${m ? "" : `<div class="skeleton" style="height:260px"></div>`}</div></div></section>
      <section class="sec tribunal-sec"><div class="split"><div class="preview-frame" style="border-color:rgba(215,184,121,.25)">${m && m.disputes[0] ? rulingDoc(m.disputes[0], true) : `<div class="empty">${I.empty}No ruling recorded yet.</div>`}</div>
        <div><span class="label" style="color:var(--gold)">The tribunal</span><h2>Judgement you can <em>verify.</em></h2><p class="intro">Each judge signs the exact bytes it received and returned. Pactum binds every vote to the contract, the dispute and the evidence hash, so a relayer can neither forge nor replay a verdict.</p><a class="btn" href="#/tribunal" style="margin-top:20px">Enter the tribunal →</a></div></div></section>
      <section class="final-cta"><span class="label">Pactum</span><h2>TRUST MUST BE<br>ENFORCEABLE.</h2><p class="intro" style="margin:0 auto 28px">Build sovereign relationships between autonomous agents with verifiable agreements and cryptographic enforcement.</p><a class="btn primary" href="#/command">ENTER THE NETWORK</a></section>
      <footer class="lfoot"><span>Pactum · NEAR HACKATHON 2026 · MIT</span><span><a href="${REPO}" target="_blank" rel="noopener">GitHub</a> · <a href="${REPO}/blob/main/RULES.md" target="_blank" rel="noopener">Rules</a> · <a href="${REPO}/blob/main/ARCHITECTURE.md" target="_blank" rel="noopener">Architecture</a></span></footer>
    </div>`;
  }

  // ---------------------------------------------------------------- app shell
  const NAV = [["verify", "Verify", I.shield.replace('viewBox="0 0 32 32"', 'viewBox="0 0 32 32" width="17" height="17"')], ["command", "Command", I.command], ["diplomacy", "Diplomacy", I.diplomacy], ["enclaves", "Enclaves", I.enclave], ["treaties", "Treaties", I.treaty], ["tribunal", "Tribunal", I.tribunal], ["simulation", "Simulations", I.sim], ["markets", "Bonded Markets", I.lock.replace('viewBox="0 0 32 32"', 'viewBox="0 0 32 32" width="17" height="17"')], ["events", "Events", I.events]];
  function shell(route, inner) {
    return `<div class="app">
      <header class="topbar"><button class="menu-btn" id="smenu" aria-label="Open navigation" aria-expanded="false">${I.menu}</button><a class="brand" href="#/">${I.logo}<span class="hide-xs">PACTUM</span></a><span class="sep hide-sm"></span>
        <div class="ctx"><span data-netstat class="hide-sm">${netstat()}</span><span class="mono hide-sm" title="Contract">${esc(S.mode === "live" ? S.contract : M()?.contract || "demo")}</span></div><span class="spacer"></span>
        <div class="seg" role="group" aria-label="Data source"><button data-mode="live" aria-pressed="${S.mode === "live"}">Live testnet</button><button data-mode="demo" aria-pressed="${S.mode === "demo"}">Demo</button></div>
        <a class="btn primary hide-sm" href="#/verify" title="Connect a testnet wallet and attack the protocol from your own enclave">Rob it yourself</a></header>
      <aside class="sidebar" id="sidebar"><nav aria-label="Application">${NAV.map(([r, l, ic]) => `<a href="#/${r}" class="${r === "tribunal" ? "tribunal" : ""}" ${route === r ? 'aria-current="page"' : ""}>${ic}${l}</a>`).join("")}</nav>
        <div class="foot"><a class="btn primary" href="#/verify" style="width:100%;justify-content:center;margin-bottom:12px">Verify in 3 min</a>${modeBadge()}<div style="margin-top:10px">${S.mode === "live" ? "Contract views over NEAR RPC. Transaction links come from the recorded testnet run." : "Scripted simulation from <span class='mono'>npm run sim</span>. No chain transactions."}</div></div></aside>
      <main class="main view-enter" id="main">${inner}</main></div>`;
  }
  const pageHead = (kicker, title, sub, tools = "") => `<div class="page-head"><div><span class="label">${kicker}</span><h1>${title}</h1><p>${sub}</p></div><div class="tools">${modeBadge()}${tools}</div></div>`;
  const loadingView = () => `<div class="grid"><div class="skeleton" style="height:70px"></div><div class="skeleton" style="height:340px"></div><div class="skeleton" style="height:180px"></div></div>`;
  const errorView = () => `<div class="notice err"><b>Could not load ${S.mode === "live" ? "testnet" : "demo"} data.</b>&nbsp;${esc(S.error)}. ${S.mode === "live" ? `Check that <span class="mono">${esc(S.contract)}</span> is a deployed Pactum contract, or switch to Demo.` : ""}</div><button class="btn" id="retry">Retry</button>`;

  function metricsBar() {
    const m = M();
    const escrow = m.enclaves.reduce((s, e) => s + e.locked, 0);
    const active = m.treaties.filter((t) => ["Active", "Disputed", "Exiting"].includes(t.status)).length;
    const open = m.disputes.filter((d) => d.status === "Open").length;
    const res = m.disputes.filter((d) => d.status === "Resolved").length;
    const cells = [
      ["Registered enclaves", m.enclaves.length, `${m.enclaves.filter((e) => e.frozen).length} frozen`],
      ["Active treaties", active, `${m.treaties.length} total`],
      ["Bonded escrow", `${near(escrow)}<small>NEAR</small>`, "locked across enclaves"],
      ["Pending disputes", open, open ? "awaiting quorum" : "none open"],
      ["Resolved disputes", res, "rulings on record"],
      [m.mode === "live" ? "Solvency (audit)" : "Attacks refused", m.mode === "live" ? (m.audit.solvent ? `<span style="color:var(--ok)">Solvent</span>` : `<span style="color:var(--fail)">Insolvent</span>`) : m.refusals.length, m.mode === "live" ? `liabilities ${near(m.audit.liabilities)} NEAR` : "in simulation"],
    ];
    return `<div class="metrics">${cells.map(([l, v, s]) => `<div class="metric"><div class="label">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("")}</div>`;
  }
  function eventStream(list, limit) {
    const m = M();
    const items = (limit ? list.slice(-limit).reverse() : list);
    if (!items.length) return `<div class="empty">${I.empty}No events recorded.</div>`;
    return `<div class="stream">${items.map((e) => { const i = m.events.indexOf(e); return `<div class="ev" data-open="event:${i}"><span class="t">#${String(e.seq).padStart(2, "0")}${e.date ? `<br>${fmtDate(e.date).slice(5, 16)}` : ""}</span><div><div class="k">${chip(EV_CLS[e.type] || "neutral", e.type)}${e.actor ? `<span class="mono mute">${esc(e.actor)}</span>` : ""}</div><div class="d">${esc(e.text)}</div>${e.detail ? `<div class="mono" style="color:var(--ok);font-size:11.5px">${esc(e.detail)}</div>` : ""}${e.tx ? `<div style="margin-top:4px">${txLink(e.tx)}</div>` : ""}</div></div>`; }).join("")}</div>`;
  }

  function vCommand() {
    const m = M();
    return pageHead("Intelligence bureau", "COMMAND CENTRE", "Live overview of the Pactum sovereign network.") +
      (m.mode === "live" && !m.evidence ? `<div class="notice">No recorded transaction evidence matches <span class="mono">${esc(m.contract)}</span>: showing contract state only.</div>` : "") +
      metricsBar() +
      `<div class="grid g-main"><section class="panel"><header><h2>Sovereign network topology</h2><span class="mono mute">${m.enclaves.length} nodes · ${m.treaties.length} links</span></header><div id="topo"></div></section>
        <section class="panel"><header><h2>Recent activity</h2><a href="#/events" class="mono">All events →</a></header><div class="body flush" style="max-height:600px;overflow:auto">${eventStream(m.events, 12)}</div></section></div>`;
  }
  function vDiplomacy() {
    const m = M();
    return pageHead("Diplomacy", "SOVEREIGN NETWORK", "Enclaves and the treaties that bind them.") +
      `<div class="grid g-main"><section class="panel"><header><h2>Network topology</h2></header><div id="topo"></div></section>
       <section class="panel"><header><h2>Relationships</h2></header><div class="body flush">${m.treaties.length ? m.treaties.map((t) => `<div class="ev" data-open="treaty:${t.id}" style="grid-template-columns:44px minmax(0,1fr) auto"><span class="t">#${t.id}</span><div><div>${esc(short(t.a))} <span class="mute">↔</span> ${esc(short(t.b))}</div><div class="mono mute">escrow ${near(t.bond_a)} + ${near(t.bond_b)} NEAR</div></div>${chip(STATUS[t.status] || "neutral", t.status)}</div>`).join("") : `<div class="empty">${I.empty}No treaties yet.</div>`}</div></section></div>`;
  }
  function vEnclaves() {
    const m = M();
    return pageHead("Registry", "SOVEREIGN ENCLAVES", "Agent identities, their collateral and standing.") +
      `<section class="panel"><header><h2>Enclave registry</h2><input class="input" id="q" placeholder="Search enclaves…" aria-label="Search enclaves" style="max-width:240px"></header>
        <div class="table-wrap"><table class="dt cards" id="tbl"><thead><tr><th>Enclave</th><th>Payout chain</th><th>Free</th><th>Escrow</th><th>Treaties</th><th>Trust</th><th>State</th></tr></thead><tbody>
        ${m.enclaves.map((e) => `<tr data-open="enclave:${esc(e.account)}" data-s="${esc(e.account)}"><td><b>${esc(e.name)}</b><div class="mono mute hide-xs">${esc(e.account)}</div></td><td data-l="chain">${chip("neutral", e.chain)}</td><td data-l="free">${near(e.free)}</td><td data-l="escrow">${near(e.locked)}</td><td data-l="treaties">${treatiesOf(e.account).length}</td><td data-l="trust">${e.score}</td><td>${e.frozen ? chip("fail", "frozen", 1) : chip("ok", "active", 1)}</td></tr>`).join("")}</tbody></table></div>
        ${m.enclaves.length ? "" : `<div class="empty">${I.empty}No enclaves registered.</div>`}</section>`;
  }

  const TSORT = { id: (t) => t.id, escrow: (t) => t.bond_a + t.bond_b, status: (t) => t.status };
  let tState = { q: "", status: "all", sort: "id", dir: 1 };
  function vTreaties() {
    const m = M();
    const statuses = [...new Set(m.treaties.map((t) => t.status))];
    return pageHead("Registry", "TREATY INTELLIGENCE", "Inspect, monitor and manage sovereign agreements.") +
      `<section class="panel"><header><h2>Treaty registry</h2><div class="filters"><input class="input" id="tq" placeholder="Search party or id…" aria-label="Search treaties" value="${esc(tState.q)}"><select class="input" id="ts" aria-label="Filter by status"><option value="all">All statuses</option>${statuses.map((s) => `<option ${tState.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div></header>
        <div class="table-wrap"><table class="dt cards"><thead><tr><th><button data-sort="id">ID ↕</button></th><th>Parties</th><th><button data-sort="escrow">Bonded escrow ↕</button></th><th><button data-sort="status">Status ↕</button></th><th>Enforcement</th><th class="hide-xs">Created</th></tr></thead><tbody id="tbody"></tbody></table></div><div id="tempty"></div></section>`;
  }
  function fillTreaties() {
    const m = M(); const q = tState.q.toLowerCase();
    const rows = m.treaties.filter((t) => (tState.status === "all" || t.status === tState.status) && (!q || `${t.id} ${t.a} ${t.b}`.toLowerCase().includes(q)))
      .sort((x, y) => { const a = TSORT[tState.sort](x), b = TSORT[tState.sort](y); return (a > b ? 1 : a < b ? -1 : 0) * tState.dir; });
    $("#tbody").innerHTML = rows.map((t) => { const ds = disputesOf(t.id); const last = ds.at(-1); return `<tr data-open="treaty:${t.id}"><td class="mono">#${t.id}</td><td>${esc(short(t.a))} <span class="mute">↔</span> ${esc(short(t.b))}</td><td data-l="escrow">${near(t.bond_a + t.bond_b)} NEAR</td><td>${chip(STATUS[t.status] || "neutral", t.status)}</td><td data-l="enforcement">${last ? verdictChip(last.verdict) : `<span class="mute">no disputes</span>`}</td><td class="hide-xs mono mute">${t.created ? fmtDate(t.created).slice(0, 10) : "—"}</td></tr>`; }).join("");
    $("#tempty").innerHTML = rows.length ? "" : `<div class="empty">${I.empty}No treaties match these filters.</div>`;
    bindRefs($("#tbody"));
  }

  function vTribunal() {
    const m = M();
    const open = m.disputes.filter((d) => d.status === "Open"), res = m.disputes.filter((d) => d.status === "Resolved");
    const sim = m.judges.some((j) => j.simulated && j.active !== false);
    return `<div class="tribunal">${pageHead("Digital constitutionalism", "PACTUM <span>TRIBUNAL</span>", "Cryptographic adjudication for sovereign agents.")}
      ${sim ? `<div class="notice">Judges on this ${m.mode === "live" ? "deployment" : "simulation"} sign with <b>simulated TEE keys</b> (model ids prefixed <span class="mono">sim/</span>). The wire format and on-chain verification are identical to NEAR AI Cloud; live models need an API key.</div>` : ""}
      <div class="metrics m4"><div class="metric"><div class="label">Pending disputes</div><div class="v">${open.length}</div></div><div class="metric"><div class="label">Resolved</div><div class="v">${res.length}</div></div><div class="metric"><div class="label">Registered judges</div><div class="v">${m.judges.filter((j) => j.active !== false).length}<small>/ ${m.judges.length}</small></div></div><div class="metric"><div class="label">Quorum</div><div class="v">2<small>of 3</small></div></div></div>
      <div class="grid g-main"><section class="panel gold"><header><h2>Ruling of record</h2>${m.disputes.length > 1 ? `<select class="input" id="dsel" aria-label="Choose dispute">${m.disputes.map((d) => `<option value="${d.id}">Dispute № ${d.id}</option>`).join("")}</select>` : ""}</header><div class="body" id="ruling">${m.disputes.length ? rulingDoc(m.disputes.at(-1)) : `<div class="empty">${I.empty}No disputes have been filed on this contract.</div>`}</div></section>
        <div class="grid" style="align-content:start"><section class="panel gold"><header><h2>Judge panel</h2></header><div class="body grid">${[...m.judges].sort((x, y) => (y.active !== false) - (x.active !== false) || x.id - y.id).map((j) => `<div class="judge-card"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(j.name)}</b>${j.active === false ? chip("neutral", "inactive") : chip("gold", j.simulated ? "simulated TEE" : "attested TEE", 1)}</div><div class="mono dim" style="margin-top:6px">${esc(j.model)}</div><dl class="kv" style="margin-top:8px;grid-template-columns:96px minmax(0,1fr);font-size:12px"><dt>Signer</dt><dd class="mono break">0x${esc(j.signing_address)}</dd><dt>Attestation</dt><dd class="mono break">${esc(shortHash(j.attestation_sha256, 16))}</dd></dl></div>`).join("") || `<div class="empty">No judges registered.</div>`}</div></section>
          <section class="panel"><header><h2>Docket</h2></header><div class="body flush">${m.disputes.map((d) => `<div class="ev" data-open="dispute:${d.id}" style="grid-template-columns:44px minmax(0,1fr) auto"><span class="t">№${d.id}</span><div>${esc(short(d.plaintiff))} v. ${esc(short(d.defendant))}<div class="mono mute">treaty #${d.treaty_id}</div></div>${d.status === "Open" ? chip("dispute", "open", 1) : verdictChip(d.verdict)}</div>`).join("") || `<div class="empty">Docket empty.</div>`}</div></section></div></div></div>`;
  }

  function vEvents() {
    const m = M(); const types = [...new Set(m.events.map((e) => e.type))];
    return pageHead("Event intelligence", "EVENT HISTORY", m.mode === "live" ? "Recorded protocol activity with transaction references." : "Every step of the simulation run, in order.") +
      `<section class="panel"><header><h2>Timeline</h2><div class="filters"><input class="input" id="eq" placeholder="Search events…" aria-label="Search events"><select class="input" id="et" aria-label="Filter by type"><option value="all">All types</option>${types.map((t) => `<option>${esc(t)}</option>`).join("")}</select><select class="input" id="eo" aria-label="Sort order"><option value="asc">Oldest first</option><option value="desc">Newest first</option></select></div></header><div id="elist"></div></section>`;
  }
  function fillEvents() {
    const m = M(); const q = $("#eq").value.toLowerCase(), t = $("#et").value, o = $("#eo").value;
    let l = m.events.filter((e) => (t === "all" || e.type === t) && (!q || `${e.type} ${e.actor} ${e.text} ${e.tx || ""}`.toLowerCase().includes(q)));
    if (o === "desc") l = [...l].reverse();
    $("#elist").innerHTML = eventStream(l); bindRefs($("#elist"));
  }

  // ---------------------------------------------------------------- war room (preserves the replay engine)
  const sim = { idx: 0, timer: null, speed: 650, st: null };
  function simReset() {
    clearInterval(sim.timer); sim.timer = null; sim.idx = 0;
    sim.st = { enclaves: {}, treaties: {}, refusals: [], rulings: [], payouts: [], disputes: 0, log: [] };
  }
  function simApply(e) {
    const st = sim.st;
    switch (e.type) {
      case "enclave_registered": st.enclaves[e.enclave] = { account: e.enclave, name: short(e.enclave), chain: e.chain, free: +e.collateral, locked: 0, frozen: false }; break;
      case "treaty_ratified": { const t = e.treaty; st.treaties[t.id] = { id: t.id, a: t.a, b: t.b, status: "Active", bond_a: +t.bond_a, bond_b: +t.bond_b }; [[t.a, t.bond_a], [t.b, t.bond_b]].forEach(([a, b]) => { const x = st.enclaves[a]; if (x) { x.free -= +b; x.locked += +b; } }); break; }
      case "rob_attempt": st.refusals.push(e); break;
      case "dispute_filed": st.disputes++; if (st.treaties[e.dispute.treaty_id]) st.treaties[e.dispute.treaty_id].status = "Disputed"; break;
      case "ruling": st.rulings.push(e); break;
      case "payout": st.payouts.push(e); break;
      case "treaty_state": { const t = st.treaties[e.treaty]; if (t) { t.status = e.status; t.bond_a = +e.bond_a; t.bond_b = +e.bond_b; } break; }
      case "frozen": if (st.enclaves[e.enclave]) st.enclaves[e.enclave].frozen = true; break;
      case "snapshot": e.snapshot.enclaves.forEach((x) => { st.enclaves[x.account] = { ...st.enclaves[x.account], ...x, free: +x.free, locked: +x.locked }; }); break;
    }
    st.log.push(e);
  }
  function simStep() { const tl = S.demo.timeline; if (sim.idx >= tl.length) return simPause(); simApply(tl[sim.idx++]); simPaint(); }
  function simPause() { clearInterval(sim.timer); sim.timer = null; simPaint(); }
  function simPlay() { if (sim.timer) return simPause(); if (sim.idx >= S.demo.timeline.length) simReset(); sim.timer = setInterval(simStep, sim.speed); simPaint(); }
  function simEnd() { simPause(); while (sim.idx < S.demo.timeline.length) simApply(S.demo.timeline[sim.idx++]); simPaint(); }

  function vSimulation() {
    return `<div class="warroom">${pageHead("War room", "TREATY BREACH SIMULATION", "Observe how Pactum responds to adversarial actions.").replace(modeBadge(), `<span class="mode-badge demo">DEMO DATA · SIMULATION</span>`)}
      <div class="notice"><b>Demonstration data.</b>&nbsp;This replays the scripted <span class="mono">npm run sim</span> run (contract mirror, simulated TEE judges). To check the real attacks against NEAR testnet, open <a href="#/verify">Verify</a> and click <b>Attempt all</b>.</div>
      <section class="panel" style="margin-bottom:var(--gap)"><div class="body" style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center">
        <div class="sim-controls"><button class="btn primary" id="sp">${I.play} Play</button><button class="btn" id="ss">${I.step} Step</button><button class="btn" id="se">${I.end} Jump to end</button><button class="btn" id="sr">${I.reset} Reset</button><label class="speed">Speed <input type="range" id="sv" min="150" max="1600" step="50" value="${1750 - sim.speed}" aria-label="Playback speed"></label></div>
        <div style="flex:1;min-width:180px"><div class="mono mute" id="spos" style="margin-bottom:6px"></div><div class="progress"><i id="sbar"></i></div></div></div></section>
      <div class="grid g-main"><section class="panel"><header><h2>Operational canvas</h2><span class="mono mute" id="scount"></span></header><div id="stopo"></div></section>
        <div class="grid" style="align-content:start"><section class="panel"><header><h2>Outcome</h2></header><div class="body outcome" id="sout"></div></section>
          <section class="panel"><header><h2>Attack log</h2></header><div class="body" id="srob" style="max-height:330px;overflow:auto"></div></section></div></div>
      <section class="panel" style="margin-top:var(--gap)"><header><h2>Event timeline</h2></header><div class="body flush" id="stl" style="max-height:380px;overflow:auto"></div></section>
      <section class="panel" style="margin-top:var(--gap)"><header><h2>On-chain refusals · NEAR testnet</h2><span class="mode-badge live">REAL TRANSACTIONS</span></header><div class="body" id="sreal"></div></section></div>`;
  }
  async function simMount() {
    try { await loadDemoFile(); } catch (e) { $("#main").insertAdjacentHTML("afterbegin", `<div class="notice err">Could not load demo-data.json: ${esc(e.message)}</div>`); return; }
    if (!sim.st) { simReset(); simPlay(); } else simPaint();
    $("#sp").onclick = simPlay; $("#ss").onclick = () => { simPause(); simStep(); }; $("#se").onclick = simEnd; $("#sr").onclick = () => { simReset(); simPaint(); };
    $("#sv").oninput = (e) => { sim.speed = 1750 - +e.target.value; if (sim.timer) { simPause(); simPlay(); } };
    // real testnet refusals (from the recorded run, independent of current mode)
    try {
      const ev = await (await fetch("data/testnet-evidence.json")).json();
      const rs = ev.items.filter((i) => /^R-ROB/.test(i.step));
      $("#sreal").innerHTML = `<p class="dim" style="margin:0 0 8px">Contract <span class="mono">${esc(ev.contract)}</span> · run ${esc(ev.generated.slice(0, 10))}</p>` + rs.map((i) => `<div class="refusal"><span class="r">${esc(i.step.split(" ")[0])}</span><div><div>${esc(i.step.replace(/^R-ROB-\S+ /, ""))} <span class="mute">· ${esc(i.proves)}</span></div><div class="msg">✓ refused: ${esc(refusalMsg(i.error))}</div>${i.hash ? txLink(i.hash) : `<span class="mute" style="font-size:12px">refused before reaching the chain (see README note)</span>`}</div></div>`).join("");
    } catch { $("#sreal").innerHTML = `<div class="empty">Testnet evidence unavailable.</div>`; }
  }
  function simPaint() {
    if (!$("#stopo") || !sim.st) return;
    const tl = S.demo.timeline, st = sim.st;
    $("#sp").innerHTML = sim.timer ? `${I.pause} Pause` : `${I.play} Play`;
    $("#spos").textContent = `Event ${sim.idx} / ${tl.length}${sim.idx >= tl.length ? " · complete" : ""}`;
    $("#sbar").style.width = `${(sim.idx / tl.length) * 100}%`;
    // canvas: reuse topology with the replay state
    const saved = S.model;
    S.model = { ...(saved || {}), mode: "demo", enclaves: Object.values(st.enclaves).map((e) => ({ score: e.score ?? 500, ...e })), treaties: Object.values(st.treaties) };
    topology($("#stopo"), { mini: false }); S.model = saved;
    $("#scount").textContent = `${Object.keys(st.enclaves).length} enclaves · ${Object.keys(st.treaties).length} treaties`;
    const last = st.log.at(-1);
    const rows = [
      ["Attacks attempted", st.refusals.length, st.refusals.length ? chip("ok", `${st.refusals.length} blocked`, 1) : chip("neutral", "none yet")],
      ["Disputes escalated", st.disputes, st.disputes ? chip("dispute", "to tribunal", 1) : chip("neutral", "none yet")],
      ["Rulings verified", st.rulings.length, st.rulings.length ? st.rulings.map((r) => verdictChip(r.final)).join(" ") : chip("neutral", "none yet")],
      ["Enforcement payouts", st.payouts.length, st.payouts.length ? chip("em", st.payouts.map((p) => `${p.amount} → ${p.chain}`).join(", ")) : chip("neutral", "none yet")],
      ["Treaties preserved", Object.values(st.treaties).filter((t) => t.status === "Active").length, chip("ok", `${Object.values(st.treaties).filter((t) => t.status === "Closed").length} closed by ruling`)],
    ];
    $("#sout").innerHTML = rows.map(([l, v, c]) => `<div class="row"><span><span class="label">${l}</span><div style="font-family:var(--f-display);font-size:20px">${v}</div></span><span style="text-align:right">${c}</span></div>`).join("") + (last ? `<div class="mono mute" style="font-size:11.5px">last: ${esc(DEMO_LABEL[last.type] || last.type)}</div>` : "");
    $("#srob").innerHTML = st.refusals.length ? st.refusals.map((e) => `<div class="refusal"><span class="r">${esc(e.rule)}</span><div><div>${esc(e.text.replace(/ -> REFUSED.*/, "").replace(/^R-ROB-\S+ /, ""))}</div><div class="msg">✓ refused: ${esc(e.refusal)}</div></div></div>`).join("") : `<div class="empty" style="padding:20px">No attacks yet in this replay.</div>`;
    $("#stl").innerHTML = st.log.length ? `<div class="stream">${[...st.log].reverse().map((e) => { const x = demoEvent(e); return `<div class="ev"><span class="t">T+${String(e.t).padStart(2, "0")}</span><div><div class="k">${chip(EV_CLS[x.type] || "neutral", x.type)}${x.actor ? `<span class="mono mute">${esc(x.actor)}</span>` : ""}</div><div class="d">${esc(e.text)}</div></div><div>${x.status ? chip("fail", "refused") : ""}</div></div>`; }).join("")}</div>` : `<div class="empty">Press Play to start the replay.</div>`;
  }

  // ---------------------------------------------------------------- verify (judge path)
  // Replays recorded attack transactions straight from NEAR testnet (archival RPC, no wallet):
  // the button fetches the real transaction NOW and shows the receipt that the chain refused.
  const ARCHIVAL = ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"];
  const TESTS = {
    "R-ROB-1": "rob1_withdraw_locked_bond", "R-ROB-4": "rob4_outsider_files_dispute", "R-ROB-5": "rob5_forged_vote · rob5_duplicate_vote · rob5_tampered_response",
    "R-ROB-6": "rob6_replay_other_dispute", "R-ROB-7": "rob7_ratify_altered_terms", "R-ROB-8": "rob8_outsider_cannot_admin", "R-ROB-9": "rob9_frozen_enclave", "R-ROB-10": "rob10_bond_over_cap",
  };
  const CAVEAT = {
    "R-ROB-7": "On testnet the treaty was already ACTIVE, so the contract refused at its state check (“not proposed”) before reaching the terms-hash check. The terms-hash refusal itself is proven by the unit test.",
    "R-ROB-8": "Never reached the chain: the script sent it as a direct transaction from an account holding 0.1 NEAR, and the client refused it for insufficient balance. The owner-only check is proven by the unit test.",
  };
  const ATTACK = {
    "R-ROB-1": "Defendant tries to withdraw its bond while the treaty is ACTIVE",
    "R-ROB-2": "Agent's function-call key calls an admin method (set_quorum)",
    "R-ROB-3": "Agent's function-call key tries to move 0.5 NEAR",
    "R-ROB-4": "Outsider files a dispute on someone else's treaty",
    "R-ROB-5": "Relayer submits forged / duplicated judge votes",
    "R-ROB-6": "Relayer replays a valid vote onto another dispute",
    "R-ROB-7": "Counterparty ratifies with altered terms",
    "R-ROB-8": "Agent calls an owner-only method",
    "R-ROB-9": "Frozen enclave tries to act",
    "R-ROB-10": "Agent bonds above its own self-imposed cap",
  };
  const V = { ev: null, judges: null, results: {} };

  async function archivalTx(hash, sender) {
    let last;
    for (const url of ARCHIVAL) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "pactum-verify", method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" } }) });
        const j = await r.json();
        if (j.error) throw new Error(j.error.cause?.name || j.error.message);
        return { ...j.result, rpc: url };
      } catch (e) { last = e; }
    }
    throw last;
  }
  const failureText = (f) => {
    const s = JSON.stringify(f);
    const m = s.match(/Smart contract panicked: ([^"\\]+)/); if (m) return { kind: "contract panic", msg: m[1] };
    const k = f?.ActionError?.kind?.DelegateActionAccessKeyError;
    if (k) return { kind: "runtime · function-call key", msg: typeof k === "string" ? k : `${Object.keys(k)[0]} ${JSON.stringify(Object.values(k)[0])}` };
    return { kind: "failure", msg: s.slice(0, 160) };
  };

  async function attempt(rule) {
    const it = V.ev.items.find((i) => i.step.startsWith(rule + " ")) || (rule === "RULING" ? V.judges?.items.find((i) => i.step === "submit_verdicts") : null);
    const out = $(`#vr-${CSS.escape(rule)}`); const btn = $(`[data-attempt="${CSS.escape(rule)}"]`);
    if (!it?.hash) { out.innerHTML = `<div class="vres warn">No transaction to fetch: ${esc(CAVEAT[rule] || "this case is covered by the unit test and the simulation.")}</div>`; V.results[rule] = "offchain"; return; }
    btn.disabled = true; out.innerHTML = `<div class="vres"><span class="skeleton" style="display:block;width:60%"></span><div class="mono mute" style="margin-top:6px">fetching ${esc(shortHash(it.hash, 10))} from archival testnet RPC…</div></div>`;
    try {
      const sender = V.ev.contract.split(".").slice(1).join(".");
      const t = await archivalTx(it.hash, sender);
      const failed = t.receipts_outcome.find((r) => r.outcome.status?.Failure);
      if (rule === "RULING") {
        const val = t.status?.SuccessValue ? atob(t.status.SuccessValue) : "";
        out.innerHTML = `<div class="vres ok"><b>✓ Succeeded on-chain</b> · returned <span class="mono">${esc(val)}</span><div class="mono mute">block ${esc(shortHash(t.transaction_outcome.block_hash, 10))} · signer ${esc(t.transaction.signer_id)} · via ${esc(new URL(t.rpc).host)}</div>${txLink(it.hash, "open on nearblocks")}</div>`;
        V.results[rule] = "ok";
      } else if (failed) {
        const f = failureText(failed.outcome.status.Failure);
        out.innerHTML = `<div class="vres ok"><b>✓ Refused on-chain</b> · ${esc(f.kind)}<div class="mono" style="color:var(--ok);margin:4px 0">${esc(f.msg)}</div><div class="mono mute">receipt ${esc(shortHash(failed.id, 8))} executed by ${esc(failed.outcome.executor_id)} · block ${esc(shortHash(t.transaction_outcome.block_hash, 10))} · via ${esc(new URL(t.rpc).host)}</div>${txLink(it.hash, "open on nearblocks")}${t.transaction.receiver_id !== V.ev.contract ? `<div class="mute" style="font-size:11.5px;margin-top:4px">Sent as a meta transaction (signed by the agent's function-call key, relayed by ${esc(t.transaction.signer_id)}): the outer transaction succeeds, and the refusal is in this receipt.</div>` : `<div class="mute" style="font-size:11.5px;margin-top:4px">Direct call by ${esc(t.transaction.signer_id)} to the contract.</div>`}</div>`;
        V.results[rule] = "refused";
      } else {
        out.innerHTML = `<div class="vres bad">✘ No failing receipt found in this transaction.</div>`; V.results[rule] = "unexpected";
      }
    } catch (e) {
      out.innerHTML = `<div class="vres bad">Could not reach archival RPC (${esc(e.message)}). The recorded refusal was: <span class="mono">${esc(refusalMsg(it.error))}</span> · ${txLink(it.hash)}</div>`; V.results[rule] = "error";
    }
    btn.disabled = false; tally();
  }
  function tally() {
    const v = Object.entries(V.results).filter(([k]) => k !== "RULING");
    const ref = v.filter(([, s]) => s === "refused").length, onchain = (V.ev?.items || []).filter((i) => /^R-ROB/.test(i.step) && i.hash).length;
    const el = $("#vtally"); if (el) el.innerHTML = v.length ? `${ref}/${onchain} on-chain attacks refused · fetched live from testnet${v.some(([, s]) => s === "error") ? " · some fetches failed (network)" : ""}` : "";
  }

  // ---- "Rob it yourself": the judge's own testnet wallet + an enclave whose key lives in this browser.
  // Libraries are pinned and loaded on demand (no build step). No Pactum keys are involved.
  const LIBS = { nc: "https://esm.sh/@hot-labs/near-connect@0.12.0", naj: "https://esm.sh/near-api-js@7.4.0" };
  const W = { connector: null, account: null, enclave: null, sk: null, lib: null, busy: false, results: {} };
  const ENCLAVE_DEPOSIT = "600000000000000000000000"; // 0.6 NEAR: 0.1 account funding + 0.5 collateral
  const yoctoOf = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
  const keyStore = (acct) => `pactum.enclave.${acct}`;
  function wLoad() {
    try { const v = JSON.parse(localStorage.getItem(keyStore(W.account)) || "null"); if (v) { W.enclave = v.enclave; W.sk = v.sk; } } catch { /* storage blocked */ }
  }
  function wSave() { try { localStorage.setItem(keyStore(W.account), JSON.stringify({ enclave: W.enclave, sk: W.sk })); } catch { /* storage blocked */ } }
  async function libs() {
    if (!W.lib) {
      const [nc, naj] = await Promise.all([import(LIBS.nc), import(LIBS.naj)]);
      W.lib = { nc, naj };
    }
    return W.lib;
  }
  async function wConnect() {
    const { nc } = await libs();
    W.connector ||= new nc.NearConnector({ network: "testnet" });
    W.connector.on("wallet:signOut", () => { W.account = null; W.enclave = null; W.sk = null; wPaint(); });
    await W.connector.connect();
    const wallet = await W.connector.wallet();
    const accts = await wallet.getAccounts({ network: "testnet" });
    W.account = accts[0]?.accountId || null;
    if (W.account) wLoad();
  }
  async function wTryRestore() {
    try {
      const { nc } = await libs();
      W.connector ||= new nc.NearConnector({ network: "testnet" });
      const wallet = await W.connector.wallet();
      const accts = await wallet.getAccounts({ network: "testnet" });
      if (accts[0]) { W.account = accts[0].accountId; wLoad(); }
    } catch { /* not signed in */ }
  }
  async function enclaveState() {
    if (!W.enclave) return null;
    try { const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: V.ev?.contract || S.contract, method_name: "get_enclave", args_base64: btoa(JSON.stringify({ account: W.enclave })) } }) });
      const j = await r.json(); return j.result ? JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) : null; } catch { return null; }
  }
  async function wCreateEnclave() {
    const { naj } = await libs();
    const C = V.ev?.contract || S.contract;
    const kp = naj.KeyPair.fromRandom("ed25519");
    const name = "j" + Math.random().toString(36).slice(2, 8);
    const wallet = await W.connector.wallet();
    const out = await wallet.signAndSendTransaction({
      signerId: W.account, receiverId: C, network: "testnet",
      actions: [{ type: "FunctionCall", params: { methodName: "register_enclave", args: { name, agent_public_key: kp.getPublicKey().toString(), beneficiary: W.account, payout: { chain: "near", address: W.account }, max_bond: yoctoOf(0.2), guardian: W.account }, gas: "150000000000000", deposit: ENCLAVE_DEPOSIT } }],
    });
    W.enclave = `${name}.${C}`; W.sk = kp.toString(); wSave();
    return out?.transaction?.hash || out?.transaction_outcome?.id;
  }
  // Sign with the enclave's function-call key (this is exactly what an agent runtime holds).
  async function asEnclave(method, args, depositYocto = "0") {
    const { naj } = await libs();
    const C = V.ev?.contract || S.contract;
    const acct = new naj.Account(W.enclave, new naj.JsonRpcProvider({ url: RPC }), naj.KeyPairSigner.fromSecretKey(W.sk));
    try {
      const r = await acct.signAndSendTransaction({ receiverId: C, actions: [naj.actions.functionCall(method, args, naj.teraToGas("20"), BigInt(depositYocto))], throwOnFailure: false });
      const hash = r.transaction?.hash || r.transaction_outcome?.id;
      const fail = r.receipts_outcome?.find((x) => x.outcome.status?.Failure) || (r.status?.Failure ? { outcome: { status: r.status } } : null);
      return fail ? { kind: "refused", hash, f: failureText(fail.outcome.status.Failure) } : { kind: "ok", hash };
    } catch (e) {
      // Rejected by the network before inclusion (e.g. function-call key permission): no tx hash exists.
      const m = String(e?.message || e);
      const k = /does not allow method|MethodNameMismatch/.test(m) ? "MethodNameMismatch" : /Deposit is not allowed with function call|DepositWithFunctionCall/.test(m) ? "DepositWithFunctionCall" : /allowance|ReceiverMismatch/i.test(m) ? "key permission" : null;
      return { kind: k ? "rejected" : "error", hash: e?.txHash, msg: k ? `${k}: ${m.slice(0, 160)}` : m.slice(0, 220) };
    }
  }
  const LIVE = [
    { id: "R-ROB-1", t: "Lock a 0.15 NEAR bond in a treaty, then withdraw 0.5 NEAR", run: async () => {
      const lock = await asEnclave("propose_treaty", { counterparty: `atlas.${V.ev.contract}`, terms: "Judge test: my enclave offers an uptime guarantee to atlas.", bond: yoctoOf(0.15), counter_bond: yoctoOf(0.1), duration_ns: String(86_400e9), notice_ns: "1000" });
      const steal = await asEnclave("withdraw_free_collateral", { amount: yoctoOf(0.5) });
      return [{ label: "propose_treaty (bond 0.15 → escrow)", ...lock }, { label: "withdraw_free_collateral 0.5", ...steal }];
    } },
    { id: "R-ROB-2", t: "Use the agent key to call the admin method set_quorum", run: async () => [{ label: "set_quorum(1)", ...(await asEnclave("set_quorum", { quorum: 1 })) }] },
    { id: "R-ROB-3", t: "Use the agent key to move NEAR (even 1 yoctoNEAR)", run: async () => [{ label: "deposit_collateral with 1 yoctoNEAR attached", ...(await asEnclave("deposit_collateral", { enclave: W.enclave }, "1")) }] },
    { id: "R-ROB-4", t: "Open a dispute on atlas ↔ meridian (a treaty you're not in)", run: async () => [{ label: "file_dispute on treaty #1", ...(await asEnclave("file_dispute", { treaty_id: 1, allegation: "I am not a party.", evidence_uri: "https://example.com/x", evidence_sha256: "a".repeat(64), dispute_bond: yoctoOf(0.1) })) }] },
    { id: "R-ROB-10", t: "Bond 0.3 NEAR, above your enclave's own 0.2 NEAR cap", run: async () => [{ label: "propose_treaty bond 0.3", ...(await asEnclave("propose_treaty", { counterparty: `atlas.${V.ev.contract}`, terms: "Judge test: over-cap bond.", bond: yoctoOf(0.3), counter_bond: yoctoOf(0.1), duration_ns: String(86_400e9), notice_ns: "1000" })) }] },
  ];
  const resLine = (r) => r.kind === "ok" ? `<div class="vres ok">✓ ${esc(r.label)}: <b>succeeded</b> ${txLink(r.hash)}</div>`
    : r.kind === "refused" ? `<div class="vres ok"><b>✓ ${esc(r.label)}: refused on-chain</b> · ${esc(r.f.kind)}<div class="mono" style="color:var(--ok)">${esc(r.f.msg)}</div>${txLink(r.hash, "your transaction on nearblocks")}</div>`
    : r.kind === "rejected" ? `<div class="vres ok"><b>✓ ${esc(r.label)}: rejected by the network</b> · function-call key permission<div class="mono" style="color:var(--ok)">${esc(r.msg)}</div><div class="mute" style="font-size:11.5px">NEAR validators refuse to include a transaction that the signing key isn't allowed to make, so no transaction hash exists.</div></div>`
    : `<div class="vres bad">${esc(r.label)}: ${esc(r.msg)}</div>`;
  async function wPaint() {
    const el = $("#robself"); if (!el) return;
    if (!W.account) {
      el.innerHTML = `<p class="dim" style="margin-top:0">Connect a NEAR <b>testnet</b> wallet (free test NEAR from the faucet). You create your own enclave with 0.6 testnet NEAR, then attack the protocol from it. Your enclave's agent key is generated and kept in this browser; Pactum never sees your wallet keys.</p><button class="btn primary" id="wconnect">Connect testnet wallet</button>`;
      $("#wconnect").onclick = async () => { $("#wconnect").disabled = true; try { await wConnect(); } catch (e) { el.insertAdjacentHTML("beforeend", `<div class="vres bad">${esc(e.message || e)}</div>`); } wPaint(); };
      return;
    }
    const st = await enclaveState();
    const e = st?.enclave;
    let html = `<div class="filters" style="justify-content:space-between"><span>Connected: <b class="mono">${esc(W.account)}</b></span><button class="btn ghost" id="wout">Disconnect</button></div>`;
    if (!W.enclave || !e) {
      html += `<p class="dim">Step 1: create your enclave, a sub-account the contract creates for you, holding only a function-call key (7 Pactum methods, 0.25 NEAR gas allowance), with 0.5 NEAR collateral and a self-imposed 0.2 NEAR bond cap. Cost: 0.6 testnet NEAR from your wallet.${W.enclave && !e ? ` <span class="mono">${esc(W.enclave)}</span> isn't active yet: wait a few seconds or create a new one.` : ""}</p><button class="btn primary" id="wcreate">Create my enclave (0.6 testnet NEAR)</button>`;
    } else {
      html += `<div class="gstat" style="margin-top:12px"><div><span class="label">Your enclave</span><b class="mono" style="font-size:12.5px;word-break:break-all">${esc(W.enclave)}</b></div><div><span class="label">Free</span><b>${near(yocto(e.free))} NEAR</b></div><div><span class="label">Escrowed</span><b>${near(yocto(e.locked))} NEAR</b></div><div><span class="label">Bond cap</span><b>${e.max_bond ? near(yocto(e.max_bond)) : "—"} NEAR</b></div></div>
        <div class="attacks">${LIVE.map((a) => `<article class="attack"><div class="ah"><span class="rid">${a.id}</span>${chip("fail", "live attack", 1)}</div><h3>${esc(a.t)}</h3><button class="btn" data-live="${a.id}">Attack from my enclave</button><div id="lr-${a.id}">${(W.results[a.id] || []).map(resLine).join("")}</div></article>`).join("")}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn ghost" id="wcancel">Cancel my open proposals (bond back)</button><button class="btn ghost" id="wtopup">Top up enclave gas (0.1 NEAR)</button><button class="btn ghost" id="wwithdraw">Withdraw my free collateral to ${esc(W.account)}</button></div><div id="wmisc"></div>`;
    }
    el.innerHTML = html;
    $("#wout").onclick = async () => { try { await W.connector.disconnect(); } catch { /* ignore */ } W.account = null; W.enclave = null; wPaint(); };
    if ($("#wcreate")) $("#wcreate").onclick = async () => {
      $("#wcreate").disabled = true; $("#wcreate").textContent = "Waiting for your wallet…";
      try { const h = await wCreateEnclave(); for (let i = 0; i < 10 && !(await enclaveState())?.enclave?.active; i++) await new Promise((ok) => setTimeout(ok, 1500)); el.insertAdjacentHTML("afterbegin", h ? `<div class="vres ok">✓ Enclave created ${txLink(h)}</div>` : ""); }
      catch (err) { el.insertAdjacentHTML("beforeend", `<div class="vres bad">${esc(err.message || err)}</div>`); }
      wPaint();
    };
    $$("[data-live]", el).forEach((b) => (b.onclick = async () => {
      const a = LIVE.find((x) => x.id === b.dataset.live); b.disabled = true; b.textContent = "Sending…";
      try { W.results[a.id] = await a.run(); } catch (err) { W.results[a.id] = [{ label: a.id, kind: "error", msg: String(err.message || err) }]; }
      wPaint();
    }));
    if ($("#wcancel")) $("#wcancel").onclick = async () => {
      const C = V.ev.contract; const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: C, method_name: "list_treaties", args_base64: btoa(JSON.stringify({ from: 0, limit: 500 })) } }) });
      const ts = JSON.parse(new TextDecoder().decode(new Uint8Array((await r.json()).result.result))).filter((t) => t.party_a === W.enclave && t.status === "Proposed");
      const outs = []; for (const t of ts) outs.push({ label: `cancel_proposal #${t.id}`, ...(await asEnclave("cancel_proposal", { treaty_id: t.id })) });
      $("#wmisc").innerHTML = outs.length ? outs.map(resLine).join("") : `<div class="vres">No open proposals.</div>`; setTimeout(wPaint, 2500);
    };
    if ($("#wtopup")) $("#wtopup").onclick = async () => {
      try {
        const wallet = await W.connector.wallet();
        const out = await wallet.signAndSendTransaction({ signerId: W.account, receiverId: W.enclave, network: "testnet", actions: [{ type: "Transfer", params: { deposit: yoctoOf(0.1) } }] });
        $("#wmisc").innerHTML = resLine({ label: "top up enclave gas 0.1 NEAR", kind: "ok", hash: out?.transaction?.hash });
      } catch (err) { $("#wmisc").innerHTML = resLine({ label: "top up", kind: "error", msg: String(err.message || err) }); }
    };
    if ($("#wwithdraw")) $("#wwithdraw").onclick = async () => {
      const amt = e.free; const r = await asEnclave("withdraw_free_collateral", { amount: amt });
      $("#wmisc").innerHTML = resLine({ label: `withdraw ${near(yocto(amt))} NEAR to ${W.account}`, ...r }); setTimeout(wPaint, 2500);
    };
  }

  const COPY = (cmd) => `<div class="cmd"><code>${esc(cmd)}</code><button class="btn ghost" data-copy="${esc(cmd)}" aria-label="Copy command">Copy</button></div>`;
  function vVerify() {
    const ruleIds = Object.keys(ATTACK);
    return pageHead("Judge path", "VERIFY IN 3 MINUTES", "Try to break a treaty, then check every claim against the chain. No wallet, no API key.").replace(modeBadge(), `<span class="mode-badge live">REAL TESTNET EVIDENCE</span>`) + `
      <section class="panel" style="margin-bottom:var(--gap)"><header><h2>Do X → See Y</h2></header><div class="body"><ol class="steps">
        <li><b>Optional, most convincing: “Rob it yourself”.</b> <span class="dim">Connect a testnet wallet, create your own enclave (0.6 testnet NEAR), and launch the attacks yourself. Each one is refused by the contract or the network, with your own transaction link.</span></li>
        <li><b>Click “Attempt all” below.</b> <span class="dim">See each recorded attack fetched live from NEAR testnet and refused: contract panics and runtime key refusals, each with its nearblocks link.</span></li>
        <li><b>Click “Check the ruling”.</b> <span class="dim">See the dispute decided by three NEAR AI Cloud TEE judges succeed on-chain (CRITICAL_BREACH).</span></li>
        <li><b>Open <a href="#/tribunal">Tribunal</a>.</b> <span class="dim">See the three real model votes, each judge's attested TEE signer, and every stage linked to its transaction.</span></li>
        <li><b>Open <a href="#/markets">Bonded Markets</a> (optional).</b> <span class="dim">See the same machinery run competitive markets: three scored rounds and a P&amp;L leaderboard (simulation, with a real testnet counterpart).</span></li>
        <li><b>Run the CLI below (optional, ~1 minute).</b> <span class="dim">See the full simulation re-run, every signature re-verified, and live contract state.</span></li>
      </ol></div></section>
      <section class="panel" id="rob" style="margin-bottom:var(--gap);border-color:rgba(184,243,107,.35)"><header><h2>Rob it yourself · your testnet wallet</h2><span class="mode-badge live">NEW REAL TRANSACTIONS</span></header><div class="body" id="robself"><div class="skeleton" style="height:40px"></div></div></section>
      <section class="panel" style="margin-bottom:var(--gap)"><header><h2>Recorded attacks · replayed from the chain</h2><div class="filters"><span class="mono" id="vtally" style="color:var(--ok)"></span><button class="btn primary" id="vall">Attempt all</button></div></header>
        <div class="body"><p class="dim" style="margin:0 0 14px">Each <b>Attempt</b> replays a real transaction already on testnet (contract <span class="mono">${esc(V.ev?.contract || S.contract)}</span>): it fetches that transaction from archival RPC right now and shows what the chain did. It does not send a new transaction.</p>
        <div class="attacks">${ruleIds.map((r) => { const it = V.ev?.items.find((i) => i.step.startsWith(r + " ")); return `<article class="attack">
          <div class="ah"><span class="rid">${r}</span>${it?.hash ? chip("ok", "on-chain", 1) : r === "R-ROB-9" ? chip("neutral", "unit test + sim") : chip("warn", "not on-chain")}</div>
          <h3>${esc(ATTACK[r])}</h3>${it?.proves ? `<div class="dim" style="font-size:12.5px">Rule proven: ${esc(it.proves)}</div>` : ""}
          ${CAVEAT[r] ? `<div class="mute" style="font-size:12px;margin-top:6px">⚠ ${esc(CAVEAT[r])}</div>` : ""}
          ${TESTS[r] ? `<div class="mono mute" style="margin-top:6px">cargo test ${esc(TESTS[r].split(" · ")[0])}</div>` : `<div class="mono mute" style="margin-top:6px">enforced by the NEAR runtime (no contract code involved)</div>`}
          <div style="margin-top:10px"><button class="btn" data-attempt="${r}">${it?.hash ? "Attempt (replay on-chain)" : "Why no transaction?"}</button></div>
          <div id="vr-${r}"></div></article>`; }).join("")}</div></div></section>
      <div class="grid g-2">
        <section class="panel gold"><header><h2>Real TEE ruling</h2></header><div class="body"><p class="dim" style="margin-top:0">Dispute #1 was decided by DeepSeek V4.1, Qwen 3.8 and GLM 5.3, running in NEAR AI Cloud TEEs. The contract recovered all three signatures with <span class="mono">ecrecover</span>.</p><button class="btn" data-attempt="RULING">Check the ruling on-chain</button><div id="vr-RULING"></div><div style="margin-top:12px"><a href="#/tribunal">Open the ruling of record →</a></div></div></section>
        <section class="panel"><header><h2>Evidence files</h2></header><div class="body"><ul class="links">
          <li><a href="${REPO}/blob/main/RULES.md" target="_blank" rel="noopener">RULES.md</a> <span class="mute">· every R-ROB id and rule cited by code and tests</span></li>
          <li><a href="${REPO}/blob/main/evidence/testnet-evidence.json" target="_blank" rel="noopener">evidence/testnet-evidence.json</a> <span class="mute">· deploy, enclaves, treaty #0, all attacks, ruling #0, Chain Signatures</span></li>
          <li><a href="${REPO}/blob/main/evidence/testnet-real-judges.json" target="_blank" rel="noopener">evidence/testnet-real-judges.json</a> <span class="mute">· TEE judges, treaty #1, dispute #1, the 3 real votes</span></li>
          <li><a href="${REPO}/tree/main/evidence/attestations" target="_blank" rel="noopener">evidence/attestations/</a> <span class="mute">· NEAR AI Cloud attestation reports per judge key</span></li>
          <li><a href="${REPO}/blob/main/evidence/sim-evidence.json" target="_blank" rel="noopener">evidence/sim-evidence.json</a> <span class="mute">· <b>simulation</b>: signed votes + refusals for npm run verify</span></li>
          <li>${acctLink(V.ev?.contract || S.contract)} <span class="mute">· the contract on nearblocks</span></li></ul></div></section></div>
      <section class="panel" style="margin-top:var(--gap)"><header><h2>Verify from the command line</h2><span class="mono mute">git clone ${esc(REPO)}</span></header><div class="body grid">
        <div>${COPY("cd pactum/offchain && npm install && npm run sim")}<div class="dim exp">Expect <span class="mono">rob attempts refused: 9/9</span>: the scripted lifecycle (<b>simulation</b>, no chain, no LLM).</div></div>
        <div>${COPY("npm run verify")}<div class="dim exp">Expect <span class="mono">all checks passed</span>: every simulated judge signature re-recovered, every quorum recomputed.</div></div>
        <div>${COPY("npm run status -- --chain")}<div class="dim exp">Expect live tables from <span class="mono">${esc(V.ev?.contract || S.contract)}</span>: 3 enclaves, 2 closed treaties, 2 CRITICAL_BREACH rulings. Plain <span class="mono">npm run status</span> shows the simulation snapshot.</div></div>
        <div>${COPY("npm test")}<div class="dim exp">Expect <span class="mono">pass 7</span>, including a TS-signed vote that the Rust contract fixture accepts.</div></div>
        <div>${COPY("cd ../contract && cargo test")}<div class="dim exp">Expect <span class="mono">24 passed</span>: each contract-level R-ROB refusal by name (Linux, macOS or WSL).</div></div>
        <div>${COPY("npm run nearai:check")}<div class="dim exp">Needs a NEAR AI key. Expect <span class="mono">3/3 models</span>: TEE signature recovers to the attested signing address.</div></div>
      </div></section>`;
  }
  async function verifyMount() {
    try {
      V.ev ||= await (await fetch("data/testnet-evidence.json")).json();
      V.judges ||= await (await fetch("data/testnet-real-judges.json")).json().catch(() => null);
    } catch (e) { $("#main").insertAdjacentHTML("afterbegin", `<div class="notice err">Could not load evidence: ${esc(e.message)}</div>`); return; }
    $("#main").innerHTML = vVerify();
    $$("[data-attempt]").forEach((b) => (b.onclick = () => attempt(b.dataset.attempt)));
    $("#vall").onclick = async () => { $("#vall").disabled = true; for (const r of Object.keys(ATTACK)) await attempt(r); $("#vall").disabled = false; };
    $$("[data-copy]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; } catch { b.textContent = "Select & copy"; } setTimeout(() => (b.textContent = "Copy"), 1500); }));
    tally();
    await wTryRestore();
    wPaint();
  }

  // ---------------------------------------------------------------- bonded markets (simulation + real counterpart)
  const MK = { data: null, real: null };
  const pnlChip = (p) => { const n = Number(p); return `<span class="pnl ${n > 0 ? "up" : n < 0 ? "down" : ""}">${n > 0 ? "+" : ""}${esc(p)} NEAR</span>`; };
  function vMarkets() {
    const d = MK.data;
    if (!d) return loadingView();
    const loop = ["Bid collateral", "Win the contract", "Deliver or defect", "Challenge", "TEE verdict", "Slash / payout / forfeit", "Reputation shift"];
    const real = MK.real;
    return pageHead("Agent economy", "BONDED MARKETS", "The same diplomatic layer runs competitive markets: agents win work by posting collateral and lose it when they fail to deliver.").replace(modeBadge(), `<span class="mode-badge demo">SIMULATION · SAME CONTRACT RULES</span>`) + `
      <section class="panel game-panel" style="margin-bottom:var(--gap)"><header><h2>Play a market · you are the vault</h2><span class="mode-badge demo">PLAYABLE SIMULATION · IN YOUR BROWSER</span></header><div class="body"><p class="dim" style="margin:0 0 14px">Award a price-feed contract to one of three bonded oracles, then judge each epoch from two independent monitors. Every challenge is settled by the same rules the contract enforces (RULES S-1 to S-5, the D-7 clamp, the dual-feed check). No wallet, no transactions.</p><div id="game"></div></div></section>
      <section class="panel" style="margin-bottom:var(--gap)"><header><h2>The loop · read this in 60 seconds</h2></header><div class="body">
        <div class="loop">${loop.map((s, i) => `<div><span class="mono">0${i + 1}</span>${esc(s)}</div>`).join("")}</div>
        <p class="dim" style="margin:14px 0 0">Nothing here is new protocol. A bid is <span class="mono">propose_treaty</span> with a bond, winning is <span class="mono">ratify</span>, a losing bid is <span class="mono">cancel_proposal</span>, a challenge is <span class="mono">file_dispute</span>, and the outcome is the tribunal's settlement rule. ${d.startCollateral} NEAR starting collateral per agent; rounds are scored by what the contract settles.</p></div></section>
      <div class="grid g-3 rounds">${d.rounds.map((r, i) => `<article class="panel round"><header><h2>Round ${i + 1}</h2>${verdictChip(r.outcome.verdict)}</header><div class="body">
        <h3>${esc(r.name)}</h3><p class="dim" style="margin:4px 0 12px">${esc(r.tagline)}</p>
        <ol class="rsteps">${r.events.map((e) => `<li>${esc(e)}</li>`).join("")}</ol>
        <div class="label" style="margin-top:12px">Economic outcome</div>
        <div class="moves">${r.moves.map((m) => `<div><b>${esc(m.agent)}</b>${pnlChip(m.delta)}${m.trust ? `<span class="mono ${m.trust > 0 ? "" : "neg"}">trust ${m.trust > 0 ? "+" : ""}${m.trust}</span>` : ""}</div>`).join("")}</div>
        <div class="mono mute" style="margin-top:10px">${esc(r.rule)}</div>
        ${r.id === "tender" && real ? `<div class="realtx"><span class="mode-badge live">REAL ON TESTNET</span><div style="margin-top:6px">The same outcome happened for real: meridian (an oracle) was slashed for stale feeds in two disputes on <span class="mono">${esc(real.contract)}</span>.</div><div style="margin-top:6px">${real.rulings.map((x) => `Dispute #${x.id} ${x.judges}: ${txLink(x.hash)}`).join("<br>")}</div></div>` : ""}
      </div></article>`).join("")}</div>
      <div class="grid g-main" style="margin-top:var(--gap)">
        <section class="panel"><header><h2>Leaderboard · after 3 rounds</h2><span class="mono mute">simulation</span></header><div class="table-wrap"><table class="dt cards"><thead><tr><th>#</th><th>Agent</th><th>Role</th><th>Net P&amp;L</th><th>Payouts won</th><th>Trust</th></tr></thead><tbody>
          ${d.leaderboard.map((l, i) => `<tr style="cursor:default"><td class="mono">${i + 1}</td><td><b>${esc(l.agent)}</b></td><td data-l="role" class="dim">${esc(l.role)}</td><td data-l="P&L">${pnlChip(l.pnl)}</td><td data-l="payouts">${esc(l.payouts)} NEAR</td><td data-l="trust">${l.trust}</td></tr>`).join("")}</tbody></table></div></section>
        <section class="panel"><header><h2>How it's scored</h2></header><div class="body">
          <p style="margin-top:0">Net P&amp;L = change in an agent's collateral (free + escrowed) + payouts it received, exactly as the contract settles them. Trust is the on-chain reputation formula (RULES S-7).</p>
          <p class="dim"><b>Honest limit:</b> the contract settles bonds, slashes, payouts and dispute bonds. Service fees written in treaty text (“pays X per epoch”) are <b>not</b> transferred by the contract, so they are not counted here.</p>
          <p class="dim">Every verdict above is signed in the same TEE wire format as the real judges and re-checked by <span class="mono">npm run verify</span> (evidence/markets-evidence.json).</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="btn" href="#/verify">See real attacks refused on-chain →</a><a class="btn ghost" href="${REPO}/blob/main/offchain/src/markets.ts" target="_blank" rel="noopener">Scenario source</a></div></div></section></div>`;
  }
  // ---- playable market: you are the vault. Same settlement rules as the contract (RULES S-1..S-7, D-3, D-7).
  const G = { s: null };
  const PROVIDERS = [
    { name: "helios", style: "Big bond, strict promise" },
    { name: "vesper", style: "Middle of the road" },
    { name: "nova", style: "Cheap bond, loose promise" },
  ];
  const rnd = (a, b) => a + Math.random() * (b - a);
  function gNew() {
    // hidden reliability (probability an epoch is clean); bids are noisy signals of it
    const rel = [rnd(0.55, 0.95), rnd(0.5, 0.9), rnd(0.35, 0.8)].sort(() => Math.random() - 0.5);
    G.s = {
      epoch: 0, maxEpochs: 6, wallet: 10, start: 10, phase: "tender", log: [], treaty: null, reading: null,
      prov: PROVIDERS.map((p, i) => ({ ...p, rel: rel[i], trust: 500, collateral: 10, bond: 0, promise: 0 })),
    };
    gBids();
  }
  function gBids() {
    G.s.prov.forEach((p) => {
      // better providers tend to bond more and promise more, with noise
      p.bond = Math.max(1, Math.min(5, Math.round((p.rel * 6 + rnd(-1.2, 1.2)) * 2) / 2));
      p.promise = Math.min(9990, Math.round((9600 + p.rel * 380 + rnd(-60, 60)) / 10) * 10);
      p.bond = Math.min(p.bond, p.collateral);
    });
  }
  const trustOf = (r) => Math.max(0, Math.min(1000, r));
  function gAward(i) {
    const s = G.s, p = s.prov[i];
    if (p.collateral < p.bond || s.wallet < 1) return;
    p.collateral -= p.bond; s.wallet -= 1;
    s.treaty = { i, bond: p.bond, myBond: 1, promise: p.promise, elevated: false };
    s.log.unshift({ k: "Treaty", t: `You award the feed contract to ${p.name}: ${near(p.bond)} NEAR bond, ${(p.promise / 100).toFixed(2)}% promise. You post 1 NEAR. Both bonds are escrowed (C-3).` });
    p.trust = trustOf(p.trust + 10);
    gEpoch();
  }
  function gEpoch() {
    const s = G.s, t = s.treaty, p = s.prov[t.i];
    s.epoch++;
    const clean = Math.random() < p.rel;
    const truth = clean ? Math.round(rnd(t.promise - 20, 9999)) : Math.round(rnd(5600, t.promise - 300));
    let a = Math.round(truth + rnd(-40, 40)), b = Math.round(truth + rnd(-40, 40));
    let rigged = false;
    if (Math.random() < 0.15) { rigged = true; if (Math.random() < 0.5) a = Math.round(rnd(5500, 7500)); else b = Math.round(rnd(5500, 7500)); } // one monitor faulty
    s.reading = { a: Math.min(10000, a), b: Math.min(10000, b), truth, rigged };
    s.phase = "epoch";
  }
  // Mirrors the judges + contract: dual-feed check (D-3), shortfall vs promise, verdict, clamp (D-7), settlement (S-*)
  function gChallenge(challenge) {
    const s = G.s, t = s.treaty, p = s.prov[t.i], r = s.reading;
    if (!challenge) {
      const breach = r.truth < t.promise - 200;
      s.log.unshift({ k: `Epoch ${s.epoch}`, t: `Monitors ${(r.a / 100).toFixed(1)}% / ${(r.b / 100).toFixed(1)}%. You accept the epoch.${breach ? ` (${p.name} actually under-delivered: a missed chance.)` : ""}` });
      if (!breach) p.trust = trustOf(p.trust + 40 / 6);
    } else {
      if (s.wallet < 0.5) return;
      s.wallet -= 0.5;
      const conflict = Math.abs(r.a - r.b) > Math.max(r.a, r.b) * 0.05;
      let raw, metric = 0;
      if (conflict) raw = "FEED_CONFLICT";
      else {
        const obs = (r.a + r.b) / 2;
        metric = Math.max(0, Math.round(((t.promise - obs) * 10000) / t.promise));
        raw = metric >= 2500 ? "CRITICAL_BREACH" : metric >= 800 ? "ELEVATED_RISK" : metric === 0 ? "MALICIOUS_REPORT" : "NORMAL";
      }
      const fin = raw === "CRITICAL_BREACH" && metric < 2500 ? "ELEVATED_RISK" : (raw === "CRITICAL_BREACH" || raw === "ELEVATED_RISK") && metric < 500 ? "NORMAL" : raw;
      let msg = "", rule = "";
      if (fin === "CRITICAL_BREACH") { s.wallet += 0.5 + t.bond + t.myBond; msg = `${p.name}'s full ${near(t.bond)} NEAR bond is slashed to you; your bonds return; treaty closed.`; rule = "S-1"; p.trust = trustOf(p.trust - 200); s.treaty = null; }
      else if (fin === "ELEVATED_RISK") {
        const cut = Math.round(t.bond * 0.25 * 1000) / 1000; t.bond -= cut; s.wallet += 0.5 + cut; p.trust = trustOf(p.trust - 80); rule = "S-2";
        if (t.elevated) { s.wallet += t.myBond; p.collateral += t.bond; msg = `25% (${near(cut)} NEAR) slashed to you. Second elevated verdict: treaty closed, remaining bonds released.`; s.treaty = null; }
        else { t.elevated = true; msg = `25% of ${p.name}'s bond (${near(cut)} NEAR) is slashed to you; the treaty continues.`; }
      }
      else if (fin === "NORMAL") { s.wallet += 0.45; msg = "No breach. 10% of your dispute bond goes to the treasury."; rule = "S-3"; }
      else if (fin === "MALICIOUS_REPORT") { p.collateral += 0.5; msg = `Both monitors show the promise was met. Your 0.5 NEAR dispute bond goes to ${p.name}.`; rule = "S-4"; p.trust = trustOf(p.trust + 20); }
      else { s.wallet += 0.5; msg = "The monitors disagree by more than 5%. Full refund, no slash."; rule = "S-5"; }
      s.log.unshift({ k: `Epoch ${s.epoch} · ${fin}`, t: `Monitors ${(r.a / 100).toFixed(1)}% / ${(r.b / 100).toFixed(1)}% vs ${(t.promise / 100).toFixed(2)}% promise${metric ? ` (shortfall ${metric} bps)` : ""}. ${msg}`, rule, v: fin });
    }
    if (s.epoch >= s.maxEpochs) {
      if (s.treaty) { s.wallet += s.treaty.myBond; s.prov[s.treaty.i].collateral += s.treaty.bond; s.prov[s.treaty.i].trust = trustOf(s.prov[s.treaty.i].trust + 40); s.log.unshift({ k: "Treaty concluded", t: "Term over: both bonds are released (T-5)." }); s.treaty = null; }
      s.phase = "over";
    } else if (!s.treaty) { s.phase = "tender"; gBids(); }
    else gEpoch();
  }
  function gView() {
    const s = G.s; if (!s) return "";
    const pnl = Math.round((s.wallet + (s.treaty ? s.treaty.myBond : 0) - s.start) * 1000) / 1000;
    const head = `<div class="gstat"><div><span class="label">Your wallet</span><b>${near(s.wallet)} NEAR</b></div><div><span class="label">P&amp;L</span>${pnlChip(String(pnl))}</div><div><span class="label">Epoch</span><b>${Math.min(s.epoch, s.maxEpochs)} / ${s.maxEpochs}</b></div><div><span class="label">Escrowed</span><b>${s.treaty ? `${near(s.treaty.myBond)} + ${near(s.treaty.bond)}` : "—"}</b></div></div>`;
    let body = "";
    if (s.phase === "tender") {
      body = `<div class="label">Tender: three oracles bid for your price-feed contract. Pick one (their reliability is hidden).</div><div class="bids">${s.prov.map((p, i) => `<button class="bid" data-g="award:${i}" ${p.collateral < p.bond ? "disabled" : ""}><b>${p.name}</b><span class="mute">${esc(p.style)}</span><span>Bond <b>${near(p.bond)} NEAR</b></span><span>Promise <b>${(p.promise / 100).toFixed(2)}%</b></span><span class="mono mute">trust ${Math.round(p.trust)} · collateral ${near(p.collateral)}</span></button>`).join("")}</div>`;
    } else if (s.phase === "epoch") {
      const r = s.reading, t = s.treaty, p = s.prov[t.i];
      body = `<div class="label">Epoch ${s.epoch}: ${p.name} served your feed. Two independent monitors report:</div>
        <div class="mons"><div><span class="label">Monitor A</span><b style="color:${r.a < t.promise ? "var(--dispute)" : "var(--ok)"}">${(r.a / 100).toFixed(2)}%</b></div><div><span class="label">Monitor B</span><b style="color:${r.b < t.promise ? "var(--dispute)" : "var(--ok)"}">${(r.b / 100).toFixed(2)}%</b></div><div><span class="label">Promised</span><b>${(t.promise / 100).toFixed(2)}%</b></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn primary" data-g="challenge" ${s.wallet < 0.5 ? "disabled" : ""}>Challenge (stake 0.5 NEAR)</button><button class="btn" data-g="accept">Accept epoch</button></div>
        <div class="mute" style="font-size:12px;margin-top:8px">A real breach pays you the slash; a false claim forfeits your stake; if the monitors disagree by more than 5%, you get a full refund.</div>`;
    } else {
      const grade = pnl >= 3 ? "Sovereign strategist" : pnl > 0 ? "Profitable" : pnl === 0 ? "Break-even" : "Outplayed";
      body = `<div class="gover"><div class="label">Game over</div><div style="font-family:var(--f-display);font-size:28px;margin:6px 0">${pnlChip(String(pnl))}</div><div class="dim">${grade}. Hidden reliability was: ${s.prov.map((p) => `${p.name} ${Math.round(p.rel * 100)}%`).join(" · ")}</div><button class="btn primary" data-g="new" style="margin-top:14px">Play again</button></div>`;
    }
    const lb = [...s.prov].sort((x, y) => y.trust - x.trust).map((p) => `<div><b>${p.name}</b><span class="mono">trust ${Math.round(p.trust)}</span><span class="mono mute">${near(p.collateral)} NEAR</span></div>`).join("");
    return `${head}<div class="gmain"><div>${body}</div><div><div class="label">Provider standings</div><div class="gstand">${lb}</div></div></div>
      <div class="glog">${s.log.slice(0, 8).map((l) => `<div><span class="k">${esc(l.k)}</span>${l.rule ? `<span class="mono" style="color:var(--gold)">${l.rule}</span>` : ""}<div>${esc(l.t)}</div></div>`).join("") || `<div class="mute">Award a contract to start.</div>`}</div>`;
  }
  function gPaint() {
    const el = $("#game"); if (!el) return;
    el.innerHTML = gView();
    $$("[data-g]", el).forEach((b) => (b.onclick = () => { const [k, v] = b.dataset.g.split(":"); if (k === "award") gAward(+v); else if (k === "challenge") gChallenge(true); else if (k === "accept") gChallenge(false); else gNew(); gPaint(); }));
  }

  async function marketsMount() {
    try {
      MK.data ||= await (await fetch("data/markets-data.json")).json();
      if (!MK.real) {
        const [a, b] = await Promise.all([fetch("data/testnet-evidence.json").then((r) => r.json()), fetch("data/testnet-real-judges.json").then((r) => r.json()).catch(() => null)]);
        MK.real = { contract: a.contract, rulings: [{ id: 0, judges: "(simulated TEE keys)", hash: a.items.find((i) => i.step === "submit_verdicts")?.hash }, ...(b ? [{ id: 1, judges: "(3 NEAR AI Cloud TEE judges)", hash: b.items.find((i) => i.step === "submit_verdicts")?.hash }] : [])].filter((x) => x.hash) };
      }
    } catch (e) { $("#main").innerHTML = `<div class="notice err">Could not load market data: ${esc(e.message)}</div>`; return; }
    $("#main").innerHTML = vMarkets();
    if (!G.s) gNew();
    gPaint();
  }

  // ---------------------------------------------------------------- router
  const VIEWS = { verify: vVerify, markets: vMarkets, command: vCommand, diplomacy: vDiplomacy, enclaves: vEnclaves, treaties: vTreaties, tribunal: vTribunal, simulation: vSimulation, events: vEvents };
  function route() { const h = location.hash.replace(/^#\/?/, ""); return h.split(/[?#]/)[0]; }
  function render() {
    const r = route();
    const root = $("#root");
    if (!r || !VIEWS[r]) {
      root.innerHTML = landing();
      if (M()) topology($("#land-topo"), { mini: true });
      bindRefs(root);
      const mb = $("#lmenu"); if (mb) mb.onclick = () => { const p = $("#lmenu-panel"); const o = p.classList.toggle("open"); mb.setAttribute("aria-expanded", o); };
      document.title = "Pactum · Sovereign digital diplomacy";
      const anchor = r && document.getElementById(r);
      if (anchor) anchor.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      return;
    }
    if (r !== "simulation" && sim.timer) simPause();
    const inner = r === "verify" || r === "markets" ? loadingView() : r === "simulation" ? vSimulation() : S.loading ? loadingView() : S.error ? errorView() : VIEWS[r]();
    root.innerHTML = shell(r, inner);
    document.title = `Pactum · ${NAV.find((n) => n[0] === r)[1]}`;
    $$("[data-mode]").forEach((b) => (b.onclick = () => b.dataset.mode !== S.mode && setMode(b.dataset.mode)));
    const sm = $("#smenu"); sm.onclick = () => { const o = $("#sidebar").classList.toggle("open"); sm.setAttribute("aria-expanded", o); };
    $$("#sidebar a").forEach((a) => a.addEventListener("click", () => $("#sidebar").classList.remove("open")));
    $("#retry")?.addEventListener("click", load);
    if (r === "simulation") return simMount();
    if (r === "verify") return verifyMount();
    if (r === "markets") return marketsMount();
    if (S.loading || S.error) return;
    bindRefs($("#main"));
    if ($("#topo")) topology($("#topo"));
    if (r === "enclaves") $("#q").oninput = (e) => $$("#tbl tbody tr").forEach((tr) => tr.classList.toggle("hidden", !tr.dataset.s.toLowerCase().includes(e.target.value.toLowerCase())));
    if (r === "treaties") {
      fillTreaties();
      $("#tq").oninput = (e) => { tState.q = e.target.value; fillTreaties(); };
      $("#ts").onchange = (e) => { tState.status = e.target.value; fillTreaties(); };
      $$("[data-sort]").forEach((b) => (b.onclick = () => { tState.dir = tState.sort === b.dataset.sort ? -tState.dir : 1; tState.sort = b.dataset.sort; fillTreaties(); }));
    }
    if (r === "events") { fillEvents(); ["eq", "et", "eo"].forEach((id) => ($("#" + id)[id === "eq" ? "oninput" : "onchange"] = fillEvents)); }
    if (r === "tribunal" && $("#dsel")) { $("#dsel").value = String(M().disputes.at(-1).id); $("#dsel").onchange = (e) => { $("#ruling").innerHTML = rulingDoc(M().disputes.find((d) => String(d.id) === e.target.value)); }; }
  }
  addEventListener("hashchange", () => { closeDrawerSilently(); render(); if (VIEWS[route()] || !route()) scrollTo(0, 0); });
  function closeDrawerSilently() { const d = $("#drawer"); if (!d.hidden) { d.classList.remove("open"); d.hidden = true; $("#scrim").classList.add("hidden"); $("#scrim").classList.remove("open"); } }

  pingNet(); setInterval(pingNet, 30000);
  load();
})();
