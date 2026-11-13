// `npm run audit:evidence`: checks every testnet transaction cited in README.md and
// evidence/testnet-*.json against the chain itself (archival RPC; no keys, no transactions).
// For each hash: does it exist, and does its on-chain outcome match the claim
// (success, or refusal in a receipt with the recorded reason)? Also cross-checks live state.
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const ARCHIVAL = ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"];
const CONTRACT = "pactum.stunner70.testnet";
const SENDER = "stunner70.testnet";

async function rpc(method: string, params: unknown) {
  let last: unknown;
  for (const url of ARCHIVAL) for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.cause?.name || j.error.message);
      return j.result;
    } catch (e) { last = e; await new Promise((ok) => setTimeout(ok, 1500)); }
  }
  throw last;
}
const view = async (m: string, a = {}) => JSON.parse(Buffer.from((await rpc("query", { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString("base64") })).result).toString());

type Claim = { hash: string; step: string; expect: "success" | "refusal"; reason?: string; source: string };
const claims = new Map<string, Claim>();
for (const f of ["evidence/testnet-evidence.json", "evidence/testnet-real-judges.json"]) {
  const ev = JSON.parse(readFileSync(new URL(f, root), "utf8"));
  for (const i of ev.items) if (i.hash) {
    const reason = String(i.error ?? "").match(/panicked: ([^"\\]+)/)?.[1] ?? String(i.error ?? "").match(/(MethodNameMismatch|DepositWithFunctionCall)/)?.[1];
    claims.set(i.hash, { hash: i.hash, step: i.step, expect: i.expected === "refusal" ? "refusal" : "success", reason, source: f });
  }
}
const readme = readFileSync(new URL("README.md", root), "utf8");
const cited = [...readme.matchAll(/nearblocks\.io\/txns\/([1-9A-HJ-NP-Za-km-z]{43,44})/g)].map((m) => m[1]);
const notInEvidence = cited.filter((h) => !claims.has(h));

let bad = 0;
const rows: string[] = [];
for (const c of claims.values()) {
  try {
    const t = await rpc("tx", { tx_hash: c.hash, sender_account_id: SENDER, wait_until: "NONE" });
    const fail = t.receipts_outcome.find((r: { outcome: { status: { Failure?: unknown } } }) => r.outcome.status.Failure);
    const got = fail ? "refusal" : "success";
    const why = fail ? (JSON.stringify(fail.outcome.status.Failure).match(/panicked: ([^"\\]+)/)?.[1] ?? JSON.stringify(fail.outcome.status.Failure).match(/(MethodNameMismatch|DepositWithFunctionCall)/)?.[1]) : undefined;
    const ok = got === c.expect && (!c.reason || c.reason === why);
    if (!ok) bad++;
    rows.push(`${ok ? "✔" : "✘"} ${c.hash.slice(0, 8)}… ${c.step.padEnd(48).slice(0, 48)} on-chain: ${got}${why ? ` (${why})` : ""}${ok ? "" : `  EXPECTED ${c.expect}${c.reason ? ` (${c.reason})` : ""}`}${cited.includes(c.hash) ? "" : "  [not cited in README]"}`);
  } catch (e) {
    bad++;
    rows.push(`✘ ${c.hash.slice(0, 8)}… ${c.step}: not found (${(e as Error).message})`);
  }
}
console.log(`Transactions in evidence files: ${claims.size} · cited in README: ${new Set(cited).size}\n`);
rows.forEach((r) => console.log(r));
if (notInEvidence.length) { bad += notInEvidence.length; console.log(`\n✘ cited in README but missing from evidence files: ${notInEvidence.join(", ")}`); }

// live state cross-check
const [enc, trs, dis, jud, pay, audit] = await Promise.all([view("list_enclaves", { from: 0, limit: 100 }), view("list_treaties", { from: 0, limit: 100 }), view("list_disputes", { from: 0, limit: 100 }), view("list_judges"), view("list_payouts", { from: 0, limit: 100 }), view("audit")]);
console.log(`\nLive state of ${CONTRACT}:`);
console.log(`  enclaves ${enc.length} · treaties ${trs.length} (${trs.map((t: { id: number; status: string }) => `#${t.id} ${t.status}`).join(", ")})`);
console.log(`  disputes ${dis.length} (${dis.map((d: { id: number; verdict: string; metric_bps: number; judges: number[] }) => `#${d.id} ${d.verdict} ${d.metric_bps}bps judges[${d.judges}]`).join(", ")})`);
console.log(`  judges ${jud.length}: active ${jud.filter((j: { active: boolean }) => j.active).map((j: { id: number; model: string }) => `${j.id}:${j.model}`).join(", ")}`);
console.log(`  payouts ${pay.map((p: { id: number; status: string; target: { chain: string } }) => `#${p.id} ${p.target.chain} ${p.status}`).join(", ")}`);
console.log(`  audit: solvent ${audit.solvent}, liabilities ${Number(BigInt(audit.liabilities) / 10n ** 21n) / 1000} NEAR`);
console.log(bad ? `\n${bad} problem(s) found` : "\nall cited transactions match their claims on-chain");
process.exit(bad ? 1 : 0);
