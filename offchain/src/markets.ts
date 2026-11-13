// Bonded Markets: competitive scenarios on the unchanged Pactum machinery (SIMULATION).
// Agents win work by posting collateral and lose it when they fail to deliver.
// Same contract mirror (ledger.ts), same signed TEE-format judges, same evidence checks.
//
// Scoring is only what the contract actually settles: bonds, slashes, payouts and
// dispute bonds, plus the on-chain trust score (RULES S-7). Service fees written in treaty
// terms are NOT transferred by the contract, so they are not counted.
import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { Ledger, Y, fmt, score } from "./ledger.ts";
import { makePanel, judgeVote } from "./judge.ts";
import { httpFetcher } from "./evidence.ts";
import { sha256hex, SimTee, binding } from "./tee.ts";

const CONTRACT = "pactum.markets.sim";
const START = 10;
type Files = Map<string, string>;
const host = (files: Files): Promise<{ srv: Server; base: string }> =>
  new Promise((ok) => {
    const srv = createServer((q, r) => { const b = files.get(q.url ?? ""); b ? r.writeHead(200).end(b) : r.writeHead(404).end(); })
      .listen(0, "127.0.0.1", () => ok({ srv, base: `http://127.0.0.1:${(srv.address() as { port: number }).port}` }));
  });

const AGENTS = [
  { name: "kestrel", role: "Lending vault (buyer of price data)", chain: "near" },
  { name: "helios", role: "Oracle provider", chain: "near" },
  { name: "vesper", role: "Oracle provider", chain: "near" },
  { name: "rook", role: "Challenger", chain: "near" },
];

export async function runMarkets(seeds: string[], log: (t: string) => void = console.log) {
  const L = new Ledger(CONTRACT, 2);
  const panel = makePanel({ seeds });
  panel.forEach((j) => L.register_judge(j.tee.model, (j.tee as SimTee).address, sha256hex(`sim-attestation:${j.tee.model}`)));
  const acct: Record<string, string> = {};
  for (const a of AGENTS) acct[a.name] = L.register_enclave(a.name, `${a.name}-ops.testnet`, { chain: "near", address: `${a.name}-ops.testnet` }, Y(START));
  const payoutsTo = (name: string) => L.payouts.filter((p) => p.to === acct[name]).reduce((s, p) => s + p.amount, 0n);
  const worth = (name: string) => { const e = L.enclaves.get(acct[name])!; return e.free + e.locked + payoutsTo(name); };
  const snap = () => Object.fromEntries(AGENTS.map((a) => [a.name, worth(a.name)]));
  const trust = () => Object.fromEntries(AGENTS.map((a) => [a.name, score(L.enclaves.get(acct[a.name])!.rep)]));
  const evidence: Array<Record<string, unknown>> = [];

  async function adjudicate(treatyId: number, plaintiff: string, defendant: string, allegation: string, feeds: [number, number], baseline: number, narrative: string) {
    const fa: Files = new Map(), fb: Files = new Map(), fe: Files = new Map();
    const [hA, hB, hE] = await Promise.all([host(fa), host(fb), host(fe)]);
    fa.set("/t.json", JSON.stringify({ [acct[defendant]]: { value_bps: feeds[0] } }));
    fb.set("/t.json", JSON.stringify({ [acct[defendant]]: { value_bps: feeds[1] } }));
    const doc = JSON.stringify({ pactum_evidence: 1, contract: CONTRACT, treaty_id: treatyId, accused: acct[defendant], metric: "uptime_bps", baseline_bps: baseline, feeds: [`${hA.base}/t.json`, `${hB.base}/t.json`], narrative });
    fe.set("/incident.json", doc);
    const d = L.file_dispute(acct[plaintiff], treatyId, allegation, `${hE.base}/incident.json`, sha256hex(doc), Y(0.5));
    const votes = await Promise.all(panel.map((j) => judgeVote(j, { ...d }, L.treaties[treatyId].terms, CONTRACT, httpFetcher(true))));
    [hA, hB, hE].forEach((h) => h.srv.close());
    const r = L.submit_verdicts(d.id, votes);
    evidence.push({ kind: "dispute", dispute_id: d.id, evidence_sha256: d.evidence_sha256, binding: binding(CONTRACT, d.id, d.evidence_sha256), ruling: { raw: r.raw, final: r.final, metric: r.metric, judges: r.judges }, votes: votes.map(({ mode, parsed, signer, model, ...v }) => v) });
    return { d, r, votes };
  }

  const rounds: Array<Record<string, unknown>> = [];
  async function round(id: string, name: string, rule: string, tagline: string, body: (ev: (t: string) => void) => Promise<{ verdict: string; metric: number }>) {
    const before = snap(), tBefore = trust();
    const events: string[] = [];
    const ev = (t: string) => { events.push(t); log(`  [${name}] ${t}`); };
    const out = await body(ev);
    const after = snap(), tAfter = trust();
    const moves = AGENTS.map((a) => ({ agent: a.name, delta: fmt(after[a.name] - before[a.name]), trust: tAfter[a.name] - tBefore[a.name] })).filter((m) => m.delta !== "0" || m.trust !== 0);
    rounds.push({ id, name, rule, tagline, events, outcome: out, moves });
  }

  log("Bonded Markets (simulation): 4 agents, 10 NEAR collateral each");

  await round("tender", "The Oracle Tender", "S-1 CRITICAL_BREACH: 100% of the defendant's bond goes to the plaintiff",
    "Two oracles bid collateral for one vault's price-feed contract. The winner fails to deliver and its bond is slashed.", async (ev) => {
      const hb = L.propose_treaty(acct.helios, acct.kestrel, "Helios serves the ETH/USD feed to Kestrel at >= 99.50% (9950 bps) uptime, measured by two independent monitors.", Y(4), Y(1), { uptime_floor_bps: 9950 });
      ev(`helios bids: 99.50% uptime, backed by a 4 NEAR bond (escrowed)`);
      const vb = L.propose_treaty(acct.vesper, acct.kestrel, "Vesper serves the ETH/USD feed to Kestrel at >= 99.00% (9900 bps) uptime, measured by two independent monitors.", Y(2.5), Y(1), { uptime_floor_bps: 9900 });
      ev(`vesper bids: 99.00% uptime, backed by a 2.5 NEAR bond (escrowed)`);
      L.ratify(acct.kestrel, hb.id, hb.terms_hash);
      ev(`kestrel awards the contract to helios (larger bond, stricter guarantee) and posts its own 1 NEAR bond`);
      L.cancel_proposal(acct.vesper, vb.id);
      ev(`vesper withdraws its losing bid; its 2.5 NEAR bond returns to free collateral`);
      const { r } = await adjudicate(hb.id, "kestrel", "helios", "Helios's feed went stale for most of the epoch.", [6900, 6980], 9950, "ETH/USD feed stale for 8 hours; both monitors recorded the outage.");
      ev(`two independent monitors read 69.0% / 69.8% uptime; 3 judges rule ${r.final} (${r.metric} bps shortfall)`);
      ev(`helios's 4 NEAR bond is slashed to kestrel; kestrel's dispute bond is refunded; treaty closed`);
      return { verdict: r.final, metric: r.metric };
    });

  await round("undercut", "The Undercut", "S-4 MALICIOUS_REPORT: the plaintiff's dispute bond goes to the defendant",
    "A challenger buys standing with an incumbent, then files a false breach claim to knock it out. The court makes it pay.", async (ev) => {
      const t = L.propose_treaty(acct.rook, acct.vesper, "Vesper serves the SOL/USD feed to Rook at >= 99.00% (9900 bps) uptime, measured by two independent monitors.", Y(1), Y(2), { uptime_floor_bps: 9900 });
      L.ratify(acct.vesper, t.id, t.terms_hash);
      ev(`rook signs a small treaty with vesper (bonds 1 + 2 NEAR) to gain standing to sue`);
      const { r } = await adjudicate(t.id, "rook", "vesper", "Vesper's feed was offline for hours.", [9990, 9985], 9900, "Vesper's SOL/USD feed was offline for hours; customers should move to Rook.");
      ev(`both monitors read 99.9% uptime, contradicting the claim; 3 judges rule ${r.final}`);
      ev(`rook's 0.5 NEAR dispute bond goes to vesper; rook's trust score drops by 150`);
      return { verdict: r.final, metric: r.metric };
    });

  await round("rigged", "The Rigged Monitor", "S-5 FEED_CONFLICT: full refund, no slash, treaty stays active",
    "A rival controls one of the two monitors and reports a fake outage. The feeds disagree, so nobody is slashed.", async (ev) => {
      const t = L.propose_treaty(acct.rook, acct.helios, "Helios serves the BTC/USD feed to Rook at >= 99.00% (9900 bps) uptime, measured by two independent monitors.", Y(1), Y(2), { uptime_floor_bps: 9900 });
      L.ratify(acct.helios, t.id, t.terms_hash);
      ev(`rook contracts helios for a BTC/USD feed (bonds 1 + 2 NEAR)`);
      const { r } = await adjudicate(t.id, "rook", "helios", "Helios's BTC/USD feed failed this epoch.", [9970, 6000], 9900, "Monitor B (operated by Rook) shows the feed down for most of the epoch.");
      ev(`monitor A reads 99.7%, rook's monitor B reads 60.0% (>5% apart); 3 judges rule ${r.final}`);
      ev(`no slash: rook's dispute bond is refunded and the treaty stays active`);
      return { verdict: r.final, metric: r.metric };
    });

  const t = trust();
  const leaderboard = AGENTS.map((a) => {
    const e = L.enclaves.get(acct[a.name])!;
    const end = worth(a.name);
    return { agent: a.name, role: a.role, start: START.toString(), free: fmt(e.free), escrow: fmt(e.locked), payouts: fmt(payoutsTo(a.name)), pnl: fmt(end - Y(START)), trust: t[a.name], rep: e.rep };
  }).sort((x, y) => Number(y.pnl) - Number(x.pnl) || y.trust - x.trust);
  log(`  leaderboard: ${leaderboard.map((l) => `${l.agent} ${Number(l.pnl) >= 0 ? "+" : ""}${l.pnl} NEAR / trust ${l.trust}`).join(" | ")}`);

  const root = new URL("../../", import.meta.url);
  const big = (_k: string, v: unknown) => (typeof v === "bigint" ? fmt(v) : v);
  writeFileSync(new URL("frontend/data/markets-data.json", root), JSON.stringify({ generated: new Date().toISOString(), mode: "simulation", contract: CONTRACT, startCollateral: START, rounds, leaderboard, scoring: "Net change in collateral + payouts received, as settled by the contract mirror. Service fees in treaty text are not transferred by the contract and are not counted." }, big, 2));
  writeFileSync(new URL("evidence/markets-evidence.json", root), JSON.stringify({ contract: CONTRACT, judges: L.judges, items: evidence }, big, 2));
  return { rounds, leaderboard };
}
