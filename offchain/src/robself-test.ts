// `npm run test:robself -- --yes`: end-to-end test of the site's "Rob it yourself" flow on testnet,
// using the SAME calls as frontend/app.js (near-api-js 7.4.0), minus the wallet popup:
//   OWNER signs register_enclave (the judge's wallet on the site) -> fresh enclave with a browser-style key
//   -> R-ROB-1/2/3/4/10 from that enclave key -> cancel proposals -> withdraw collateral back.
// Signs testnet transactions with OWNER from .env, so it never runs without --yes (P-1).
import { existsSync, writeFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, teraToGas } from "near-api-js";
import { accountFromEnv, call, EXPLORER, RPC } from "./chain.ts";

const root = new URL("../../", import.meta.url);
if (existsSync(new URL(".env", root))) process.loadEnvFile(new URL(".env", root));
const C = process.env.PACTUM_CONTRACT!;
const yoctoOf = (n: number) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const provider = new JsonRpcProvider({ url: RPC });
const view = async (m: string, a: object) => (await provider.callFunction({ contractId: C, method: m, args: a })) as Record<string, unknown> | null;

const failureText = (f: unknown) => {
  const s = JSON.stringify(f);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/); if (m) return { kind: "contract panic", msg: m[1] };
  const k = (f as { ActionError?: { kind?: { DelegateActionAccessKeyError?: unknown } } })?.ActionError?.kind?.DelegateActionAccessKeyError;
  if (k) return { kind: "runtime · function-call key", msg: JSON.stringify(k) };
  return { kind: "failure", msg: s.slice(0, 160) };
};
// identical to asEnclave() in frontend/app.js
async function asEnclave(agent: Account, method: string, args: object, depositYocto = "0") {
  try {
    const r = await agent.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall(method, args, teraToGas("20"), BigInt(depositYocto))], throwOnFailure: false });
    const hash = (r as { transaction?: { hash?: string } }).transaction?.hash;
    const outs = (r as { receipts_outcome?: Array<{ outcome: { status: { Failure?: unknown } } }> }).receipts_outcome || [];
    const fail = outs.find((x) => x.outcome.status?.Failure);
    if (!fail) return { kind: "ok", hash };
    const f = failureText(fail.outcome.status.Failure);
    return { kind: "refused", hash, reason: f.kind, msg: f.msg };
  } catch (e) {
    const m = String((e as Error)?.message || e);
    const k = /does not allow method|MethodNameMismatch/.test(m) ? "MethodNameMismatch" : /Deposit is not allowed with function call|DepositWithFunctionCall/.test(m) ? "DepositWithFunctionCall" : /allowance|ReceiverMismatch/i.test(m) ? "key permission" : null;
    return { kind: k ? "rejected" : "error", msg: k ? `${k}: ${m.slice(0, 160)}` : m.slice(0, 300) };
  }
}

async function main() {
  console.log(`Plan: OWNER registers a judge-style enclave on ${C} (0.6 NEAR), runs R-ROB-1/2/3/4/10 from it, cancels, withdraws back.`);
  if (!process.argv.includes("--yes")) { console.log("Nothing signed. Re-run with --yes."); return; }
  const owner = accountFromEnv("OWNER");
  const results: Array<Record<string, unknown>> = [];
  const rec = (step: string, expect: string, r: Record<string, unknown>) => {
    const pass = expect === "ok" ? r.kind === "ok" : expect === "refused" ? r.kind === "refused" : r.kind === "rejected";
    results.push({ step, expect, pass, ...r, url: r.hash ? EXPLORER + r.hash : undefined });
    console.log(`${pass ? "✔" : "✘"} ${step}: ${r.kind}${r.msg ? ` · ${r.msg}` : ""}${r.hash ? ` ${EXPLORER}${r.hash}` : ""}`);
  };

  // 1. register (the site: signed by the judge's wallet)
  const kp = KeyPair.fromRandom("ed25519");
  const name = "j" + Math.random().toString(36).slice(2, 8);
  const enclave = `${name}.${C}`;
  const reg = await call(owner, "register_enclave", { name, agent_public_key: kp.getPublicKey().toString(), beneficiary: owner.accountId, payout: { chain: "near", address: owner.accountId }, max_bond: yoctoOf(0.2), guardian: owner.accountId }, BigInt("600000000000000000000000"), 150);
  rec("register_enclave (0.6 NEAR, cap 0.2)", "ok", { kind: reg.ok ? "ok" : "error", hash: reg.hash, msg: reg.error });
  let st: Record<string, unknown> | null = null;
  for (let i = 0; i < 12; i++) { st = await view("get_enclave", { account: enclave }); if ((st?.enclave as { active?: boolean })?.active) break; await new Promise((ok) => setTimeout(ok, 1500)); }
  console.log(`  enclave ${enclave} active=${(st?.enclave as { active?: boolean })?.active}`);
  const agent = new Account(enclave, provider, KeyPairSigner.fromSecretKey(kp.toString() as never));

  // 2. attacks, exactly as the site's LIVE list
  rec("R-ROB-1a propose_treaty bond 0.15 (escrow)", "ok", await asEnclave(agent, "propose_treaty", { counterparty: `atlas.${C}`, terms: "Judge test: my enclave offers an uptime guarantee to atlas.", bond: yoctoOf(0.15), counter_bond: yoctoOf(0.1), duration_ns: String(86_400e9), notice_ns: "1000" }));
  rec("R-ROB-1b withdraw_free_collateral 0.5", "refused", await asEnclave(agent, "withdraw_free_collateral", { amount: yoctoOf(0.5) }));
  rec("R-ROB-2 set_quorum with agent key", "rejected", await asEnclave(agent, "set_quorum", { quorum: 1 }));
  rec("R-ROB-3 attach 1 yoctoNEAR with agent key", "rejected", await asEnclave(agent, "deposit_collateral", { enclave }, "1"));
  rec("R-ROB-4 file_dispute on treaty #1", "refused", await asEnclave(agent, "file_dispute", { treaty_id: 1, allegation: "I am not a party.", evidence_uri: "https://example.com/x", evidence_sha256: "a".repeat(64), dispute_bond: yoctoOf(0.1) }));
  rec("R-ROB-10 propose_treaty bond 0.3 over cap 0.2", "refused", await asEnclave(agent, "propose_treaty", { counterparty: `atlas.${C}`, terms: "Judge test: over-cap bond.", bond: yoctoOf(0.3), counter_bond: yoctoOf(0.1), duration_ns: String(86_400e9), notice_ns: "1000" }));

  // 3. clean up: cancel proposals, withdraw everything back to the wallet
  const ts = (await provider.callFunction({ contractId: C, method: "list_treaties", args: { from: 0, limit: 500 } })) as Array<{ id: number; party_a: string; status: string }>;
  for (const t of ts.filter((x) => x.party_a === enclave && x.status === "Proposed")) rec(`cancel_proposal #${t.id}`, "ok", await asEnclave(agent, "cancel_proposal", { treaty_id: t.id }));
  const after = (await view("get_enclave", { account: enclave }))?.enclave as { free: string; locked: string };
  rec(`withdraw ${Number(BigInt(after.free) / 10n ** 21n) / 1000} NEAR to ${owner.accountId}`, "ok", await asEnclave(agent, "withdraw_free_collateral", { amount: after.free }));
  const fin = (await view("get_enclave", { account: enclave }))?.enclave as { free: string; locked: string };
  console.log(`  final enclave balances: free ${fin.free}, locked ${fin.locked}`);

  const passed = results.filter((r) => r.pass).length;
  writeFileSync(new URL("evidence/robself-test.json", root), JSON.stringify({ network: "testnet", contract: C, enclave, generated: new Date().toISOString(), note: "Same calls as the site's Rob-it-yourself flow; register_enclave signed by stunner70.testnet in place of a wallet popup", results }, null, 2));
  console.log(`\n${passed}/${results.length} steps behaved as expected · wrote evidence/robself-test.json`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
