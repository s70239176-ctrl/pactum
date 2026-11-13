// `npm run status` (sim snapshot) or `npm run status -- --chain` (live testnet views).
// Shows active enclaves, live treaties, escrow balances, open disputes, final rulings.
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../../", import.meta.url);
if (existsSync(new URL(".env", root))) process.loadEnvFile(new URL(".env", root));
const Yn = (y: string) => (Number(BigInt(y) / 10n ** 21n) / 1000).toString();

async function load() {
  if (!process.argv.includes("--chain")) {
    const d = JSON.parse(readFileSync(new URL("frontend/data/demo-data.json", root), "utf8"));
    return { source: `simulation (${d.generated})`, ...d.timeline.find((e: { type: string }) => e.type === "snapshot").snapshot };
  }
  const { view, contractId } = await import("./chain.ts");
  const enc = await view<Array<{ enclave: { account: string; name: string; payout: { chain: string }; free: string; locked: string; frozen: boolean }; score: number }>>("list_enclaves", { from: 0, limit: 100 });
  const tr = await view<Array<{ id: number; party_a: string; party_b: string; status: string; bond_a: string; bond_b: string }>>("list_treaties", { from: 0, limit: 200 });
  const ds = await view<Array<{ id: number; treaty_id: number; plaintiff: string; defendant: string; status: string; verdict?: string; raw_verdict?: string; metric_bps?: number }>>("list_disputes", { from: 0, limit: 200 });
  const audit = await view<{ liabilities: string; solvent: boolean }>("audit");
  return {
    source: `testnet ${contractId()}`,
    enclaves: enc.map(({ enclave: e, score }) => ({ name: e.name, account: e.account, chain: e.payout.chain, free: Yn(e.free), locked: Yn(e.locked), frozen: e.frozen, score })),
    treaties: tr.map((t) => ({ id: t.id, a: t.party_a, b: t.party_b, status: t.status, bond_a: Yn(t.bond_a), bond_b: Yn(t.bond_b) })),
    disputes: ds.map((d) => ({ ...d, raw: d.raw_verdict })),
    liabilities: `${Yn(audit.liabilities)} (solvent: ${audit.solvent})`,
  };
}

const s = await load();
const short = (a: string) => a.split(".")[0];
console.log(`\nPACTUM status - ${s.source}\n`);
console.log("ENCLAVES");
console.table(s.enclaves.map((e: Record<string, unknown>) => ({ enclave: e.name, chain: e.chain, "free NEAR": e.free, "escrow NEAR": e.locked, trust: e.score, frozen: e.frozen })));
console.log("TREATIES");
console.table(s.treaties.map((t: Record<string, string>) => ({ id: t.id, parties: `${short(t.a)} <-> ${short(t.b)}`, status: t.status, "escrow a": t.bond_a, "escrow b": t.bond_b })));
console.log("DISPUTES / RULINGS");
console.table(s.disputes.map((d: Record<string, string>) => ({ id: d.id, treaty: d.treaty_id, plaintiff: short(d.plaintiff), defendant: short(d.defendant), status: d.status, ruling: d.verdict ?? "-", raw: d.raw ?? "-", "metric bps": d.metric_bps ?? "-" })));
console.log(`total liabilities: ${s.liabilities} NEAR\n`);
