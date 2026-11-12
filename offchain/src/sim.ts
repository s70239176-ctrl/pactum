// `npm run sim`: the whole Pactum lifecycle with zero chain and zero LLM calls (D-9).
// Scripted agents, SimTee judges (same EIP-191 wire format as NEAR AI Cloud),
// contract-mirror ledger, local evidence + telemetry hosts.
// Outputs: frontend/demo-data.json (war room) and evidence/sim-evidence.json (npm run verify).
import { createServer, type Server } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { negotiate, type Agent, type ScriptedDeal } from "./agents.ts";
import { makePanel, judgeVote, PANEL } from "./judge.ts";
import { httpFetcher } from "./evidence.ts";
import { sha256hex, type TeeVote } from "./tee.ts";
import { SimTee } from "./tee.ts";
import { Ledger, Refusal, Y, fmt, score, AGENT_METHODS } from "./ledger.ts";
import { quoteBondFunding } from "./intents.ts";

const CONTRACT = process.env.PACTUM_CONTRACT ?? "pactum.sim.testnet";
const big = (_k: string, v: unknown) => (typeof v === "bigint" ? fmt(v) : v);
const LIVE_QUOTE = process.argv.includes("--quote");
const timeline: Array<Record<string, unknown>> = [];
const evidence: Array<Record<string, unknown>> = [];
const log = (type: string, data: Record<string, unknown>) => {
  timeline.push({ t: timeline.length, type, ...data });
  console.log(`\x1b[36m[${type}]\x1b[0m ${data.text}`);
};

// Deterministic sim judge keys (public test keys, NOT secrets). Override with SIM_JUDGE_SEEDS.
const SEEDS = (process.env.SIM_JUDGE_SEEDS?.split(",") ?? ["11", "22", "33"].map((b) => b.repeat(32)));

const AGENTS: Array<Agent & { collateral: number }> = [
  { account: "", name: "atlas", persona: "You run a lending vault on Base. Risk-averse.", homeChain: "base", payoutAddress: "0x7a11a5000000000000000000000000000000a71a", collateral: 20 },
  { account: "", name: "meridian", persona: "You sell oracle data. Want low bonds.", homeChain: "near", payoutAddress: "meridian-ops.testnet", collateral: 20 },
  { account: "", name: "corvid", persona: "You are a Solana market maker. Aggressive.", homeChain: "solana", payoutAddress: "CoRViD1111111111111111111111111111111111111", collateral: 15 },
  { account: "", name: "lyra", persona: "You underwrite insurance on Ethereum. Careful.", homeChain: "ethereum", payoutAddress: "0x1a642f0e3c3af545e7acbd38b07251b3990914f1", collateral: 15 },
];

type Files = Map<string, string>;
const host = (files: Files): Promise<{ srv: Server; base: string }> =>
  new Promise((ok) => {
    const srv = createServer((q, r) => { const b = files.get(q.url ?? ""); b ? r.writeHead(200, { "Content-Type": "application/json" }).end(b) : r.writeHead(404).end(); })
      .listen(0, "127.0.0.1", () => ok({ srv, base: `http://127.0.0.1:${(srv.address() as { port: number }).port}` }));
  });

/** NEAR runtime rule for function-call keys (A-3): allowed method, zero deposit. */
function fcKey(method: string, deposit: bigint) {
  if (deposit > 0n) throw new Refusal("DepositWithFunctionCallAccessKey: function-call keys cannot attach deposits");
  if (!AGENT_METHODS.includes(method)) throw new Refusal(`MethodNameMismatch: ${method} is not in the key's allow-list`);
}

async function main() {
  const L = new Ledger(CONTRACT, 2);
  const panel = makePanel({ seeds: SEEDS });
  for (const j of panel) {
    const att = sha256hex(`sim-attestation:${j.tee.model}`);
    L.register_judge(j.tee.model, (j.tee as SimTee).address, att);
  }
  log("intro", {
    text: `Pactum sim: contract ${CONTRACT}, ${panel.length} TEE judges (simulation), quorum ${L.quorum}`,
    contract: CONTRACT,
    judges: L.judges.map((j, i) => ({ ...j, name: panel[i].name })),
  });

  // --- 0. funding leg (NEAR Intents 1-Click): dry quote only, never spends (P-2)
  if (LIVE_QUOTE) {
    try {
      const q = await quoteBondFunding({ originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", amountIn: "10000000", recipient: "atlas-ops.near", refundTo: AGENTS[0].payoutAddress, dry: true });
      log("intents_quote", { text: `NEAR Intents 1-Click dry quote: 10 USDC (Base) -> ${q.amountOutFormatted ?? q.amountOut} wNEAR`, quote: q, live: true });
    } catch (e) {
      log("intents_quote", { text: `1-Click dry quote failed: ${(e as Error).message.slice(0, 120)}`, live: false });
    }
  } else {
    log("intents_quote", { text: "Funding leg: collateral would arrive via NEAR Intents 1-Click (run `npm run sim -- --quote` for a live dry quote). Sim credits it directly.", live: false });
  }

  // --- 1. enclaves (A-2): sub-accounts with function-call keys only
  for (const a of AGENTS) {
    a.account = L.register_enclave(a.name, `${a.name}-ops.testnet`, { chain: a.homeChain, address: a.payoutAddress }, Y(a.collateral));
    log("enclave_registered", { enclave: a.account, chain: a.homeChain, collateral: a.collateral, text: `Enclave ${a.account} created with a function-call key (${AGENT_METHODS.length} methods, 0.25 NEAR allowance); ${a.collateral} NEAR collateral` });
  }
  const [atlas, meridian, corvid, lyra] = AGENTS;
  L.set_policy(corvid.account, Y(8), "guardian.testnet");
  log("policy", { enclave: corvid.account, text: `corvid sets a self-imposed bond cap of 8 NEAR and guardian.testnet` });

  const scenarios: Array<{ a: Agent; b: Agent; goal: string; script: ScriptedDeal; feeds: [number, number]; baseline: number; narrative: string; allegation: string; params: Record<string, number> }> = [
    { a: atlas, b: meridian, goal: "secure a reliable ETH/USD oracle", script: { service: "keep the ETH/USD price oracle live", open: 9900, counter: 9800, settle: 9850, bonds: [8, 5, 6] }, feeds: [6020, 6110], baseline: 9850, params: { uptime_floor_bps: 9850 }, allegation: "Meridian's oracle was down for most of epoch 812; our vault could not liquidate.", narrative: "ETH/USD feed stale 9h41m during a 14% drawdown. Liquidations stalled." },
    { a: corvid, b: lyra, goal: "insure market-making inventory", script: { service: "process valid inventory-loss claims within one epoch", open: 9950, counter: 9850, settle: 9900, bonds: [8, 6, 7] }, feeds: [9990, 9980], baseline: 9900, params: { claims_sla_bps: 9900 }, allegation: "Lyra refused a valid claim.", narrative: "This claim is fabricated: the claims desk was online all epoch." },
    { a: lyra, b: corvid, goal: "keep SOL/USDC quotes live", script: { service: "keep two-sided SOL/USDC quotes live", open: 9700, counter: 9300, settle: 9500, bonds: [6, 3, 4] }, feeds: [7000, 9600], baseline: 9500, params: { quote_uptime_bps: 9500 }, allegation: "Corvid pulled its quotes during congestion.", narrative: "Quote uptime fell during congestion per our monitor." },
  ];

  const treaties: number[] = [];
  for (const [i, s] of scenarios.entries()) {
    const n = await negotiate(s.a, s.b, s.goal, s.script);
    for (const o of n.history) log("offer", { scenario: i, from: o.from, to: o.from === s.a.account ? s.b.account : s.a.account, text: `${o.from.split(".")[0]}: ${o.accept ? "ACCEPT" : o.note}` });
    fcKey("propose_treaty", 0n);
    const t = L.propose_treaty(s.a.account, s.b.account, n.final.terms, Y(n.final.bond_near), Y(n.final.counter_bond_near), s.params);
    fcKey("ratify", 0n);
    L.ratify(s.b.account, t.id, t.terms_hash);
    treaties.push(t.id);
    log("treaty_ratified", { treaty: { id: t.id, a: t.party_a, b: t.party_b, bond_a: fmt(t.bond_a), bond_b: fmt(t.bond_b), terms_hash: t.terms_hash, params: t.params }, text: `Treaty #${t.id} ${s.a.name}<->${s.b.name} ACTIVE via meta-tx; escrow ${fmt(t.bond_a)} + ${fmt(t.bond_b)} NEAR; terms_hash ${t.terms_hash.slice(0, 12)}...` });
  }

  // --- 2. "try to rob / break the treaty" (RULES.md Part G)
  const rob = (id: string, who: string, what: string, f: () => unknown) => {
    try { f(); log("rob_attempt", { rule: id, who, ok: true, text: `${id} ${what}: NOT refused (bug!)` }); evidence.push({ rule: id, refused: false }); }
    catch (e) { const msg = (e as Error).message; log("rob_attempt", { rule: id, who, ok: false, refusal: msg, text: `${id} ${what} -> REFUSED: ${msg}` }); evidence.push({ rule: id, attack: what, refused: true, message: msg }); }
  };
  rob("R-ROB-1", meridian.account, "meridian withdraws its locked 6 NEAR bond + everything", () => { fcKey("withdraw_free_collateral", 0n); L.withdraw_free_collateral(meridian.account, Y(20)); });
  rob("R-ROB-2", meridian.account, "meridian's agent key calls set_quorum(1)", () => fcKey("set_quorum", 0n));
  rob("R-ROB-3", meridian.account, "meridian's agent key transfers 5 NEAR out", () => fcKey("deposit_collateral", Y(5)));
  rob("R-ROB-4", corvid.account, "corvid files a dispute on atlas<->meridian", () => L.file_dispute(corvid.account, treaties[0], "x", "https://e.example/x", "a".repeat(64), Y(0.2)));
  rob("R-ROB-7", lyra.account, "lyra ratifies a treaty with altered terms", () => { const t = L.propose_treaty(corvid.account, lyra.account, "original terms", Y(1), Y(1)); L.ratify(lyra.account, t.id, sha256hex("altered terms")); });
  rob("R-ROB-10", corvid.account, "corvid proposes a 9 NEAR bond above its own 8 NEAR cap", () => L.propose_treaty(corvid.account, atlas.account, "x", Y(9), Y(1)));

  // --- 3. disputes, TEE adjudication, settlement
  for (const [i, s] of scenarios.entries()) {
    const tid = treaties[i];
    const defendant = s.b, plaintiff = s.a;
    const fa: Files = new Map(), fb: Files = new Map(), fe: Files = new Map();
    const [hA, hB, hE] = await Promise.all([host(fa), host(fb), host(fe)]);
    fa.set("/telemetry.json", JSON.stringify({ [defendant.account]: { value_bps: s.feeds[0] } }));
    fb.set("/telemetry.json", JSON.stringify({ [defendant.account]: { value_bps: s.feeds[1] } }));
    const doc = JSON.stringify({ pactum_evidence: 1, contract: CONTRACT, treaty_id: tid, accused: defendant.account, metric: Object.keys(s.params)[0], baseline_bps: s.baseline, feeds: [`${hA.base}/telemetry.json`, `${hB.base}/telemetry.json`], narrative: s.narrative });
    fe.set("/incident.json", doc);
    fcKey("file_dispute", 0n);
    const d = L.file_dispute(plaintiff.account, tid, s.allegation, `${hE.base}/incident.json`, sha256hex(doc), Y(0.5));
    log("dispute_filed", { dispute: { id: d.id, treaty_id: tid, plaintiff: d.plaintiff, defendant: d.defendant, evidence_sha256: d.evidence_sha256 }, text: `${plaintiff.name} files dispute #${d.id} vs ${defendant.name}: "${s.allegation}" (evidence sha256 ${d.evidence_sha256.slice(0, 12)}..., bond 0.5 NEAR)` });

    const votes: Array<TeeVote & { mode: string; parsed: Record<string, unknown> }> = await Promise.all(panel.map((j) => judgeVote(j, { ...d, evidence_sha256: d.evidence_sha256 }, L.treaties[tid].terms, CONTRACT, httpFetcher(true))));
    [hA, hB, hE].forEach((h) => h.srv.close());
    for (const v of votes) log("judge_vote", { dispute: d.id, judge: v.judge_id, verdict: v.parsed.verdict, metric_bps: v.parsed.metric_bps, mode: v.mode, signature: v.signature.slice(0, 18) + "...", text: `${panel[v.judge_id].name} [${v.mode}] -> ${v.parsed.verdict} (${v.parsed.metric_bps} bps), TEE sig ${v.signature.slice(0, 14)}...` });

    if (i === 0) {
      // R-ROB-5/6 against a live dispute: forged slot + replay
      const forged = { ...votes[0], judge_id: 1 };
      rob("R-ROB-5", "relayer", "relayer submits judge 0's vote twice, once in judge 1's slot", () => L.submit_verdicts(d.id, [votes[0], votes[0], forged]));
      const tampered = { ...votes[1], response_body: votes[1].response_body.replace("CRITICAL_BREACH", "NORMAL") };
      rob("R-ROB-5b", "relayer", "relayer rewrites a judge's verdict in the response body", () => L.submit_verdicts(d.id, [votes[0], tampered]));
    }
    const r = L.submit_verdicts(d.id, votes);
    log("ruling", { dispute: d.id, raw: r.raw, final: r.final, metric_bps: r.metric, judges: r.judges, text: `RULING #${d.id}: ${r.judges.length}/${panel.length} TEE signatures recovered on-chain -> ${r.final}${r.raw !== r.final ? ` (clamped from ${r.raw})` : ""}` });
    for (const p of r.payouts) log("payout", { dispute: d.id, chain: p.chain, to: p.address, enclave: p.to, amount: fmt(p.amount), text: p.chain === "near" ? `${fmt(p.amount)} NEAR -> ${p.address}` : `${fmt(p.amount)} NEAR queued for ${p.chain}:${p.address} -> Chain Signatures sign(path=${p.path}, domain=${p.chain === "solana" ? 1 : 0})` });
    const t = L.treaties[tid];
    log("treaty_state", { treaty: tid, status: t.status, bond_a: fmt(t.bond_a), bond_b: fmt(t.bond_b), text: `Treaty #${tid} ${t.status}; escrow ${fmt(t.bond_a)} + ${fmt(t.bond_b)} NEAR` });
    evidence.push({ kind: "dispute", dispute_id: d.id, evidence_sha256: d.evidence_sha256, binding: `pactum:v1|${CONTRACT}|${d.id}|${d.evidence_sha256}`, ruling: r, votes: votes.map(({ mode, parsed, ...v }) => v) });
  }

  // --- 4. frozen enclave (R-ROB-9)
  L.set_frozen("guardian.testnet", corvid.account, true);
  log("frozen", { enclave: corvid.account, text: "guardian.testnet freezes corvid (suspected key compromise)" });
  rob("R-ROB-9", corvid.account, "frozen corvid tries to withdraw 1 NEAR", () => L.withdraw_free_collateral(corvid.account, Y(1)));

  const snapshot = {
    enclaves: [...L.enclaves.values()].map((e) => ({ account: e.account, name: e.name, chain: e.payout.chain, free: fmt(e.free), locked: fmt(e.locked), frozen: e.frozen, score: score(e.rep), rep: e.rep })),
    treaties: L.treaties.map((t) => ({ id: t.id, a: t.party_a, b: t.party_b, status: t.status, bond_a: fmt(t.bond_a), bond_b: fmt(t.bond_b) })),
    disputes: L.disputes.map((d) => ({ id: d.id, treaty_id: d.treaty_id, plaintiff: d.plaintiff, defendant: d.defendant, status: d.status, verdict: d.verdict, raw: d.raw, metric_bps: d.metric_bps })),
    payouts: L.payouts.map((p) => ({ ...p, amount: fmt(p.amount) })),
    liabilities: fmt(L.liabilities()),
  };
  log("snapshot", { snapshot, text: `Final: ${snapshot.enclaves.map((e) => `${e.name} free ${e.free} / locked ${e.locked} / trust ${e.score}`).join(" | ")}` });

  const root = new URL("../../", import.meta.url);
  mkdirSync(new URL("evidence/", root), { recursive: true });
  writeFileSync(new URL("frontend/demo-data.json", root), JSON.stringify({ generated: new Date().toISOString(), mode: "simulation", contract: CONTRACT, timeline }, big, 2));
  writeFileSync(new URL("evidence/sim-evidence.json", root), JSON.stringify({ contract: CONTRACT, judges: L.judges, items: evidence }, big, 2));
  const refused = evidence.filter((e) => e.refused).length, robs = evidence.filter((e) => "refused" in e).length;
  console.log(`\nrob attempts refused: ${refused}/${robs}. wrote frontend/demo-data.json and evidence/sim-evidence.json`);
  if (refused !== robs) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
void PANEL;
