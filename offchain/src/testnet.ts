// `npm run testnet -- --yes`: the full lifecycle on NEAR testnet with REAL
// transactions, REAL on-chain refusals and a REAL Chain Signatures request.
// It signs transactions with keys from .env, so it never runs without --yes (P-1).
//
//   --deploy    also create PACTUM_CONTRACT as a sub-account of OWNER and deploy+init
//               contract/target/near/pactum.wasm (build first: `cargo near build`)
//
// Output: evidence/testnet-evidence.json (every tx hash + explorer link + what it proves).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { accountFromEnv, agentAccount, call, metaCall, view, contractId, EXPLORER, NETWORK, provider, type TxResult } from "./chain.ts";
import { makePanel, judgeVote } from "./judge.ts";
import { httpFetcher } from "./evidence.ts";
import { fetchAttestation, sha256hex, SimTee } from "./tee.ts";

const root = new URL("../../", import.meta.url);
if (existsSync(new URL(".env", root))) process.loadEnvFile(new URL(".env", root));
const N = (n: string) => BigInt(nearToYocto(n));
const Ys = (n: string) => nearToYocto(n).toString();
const evidence: Array<Record<string, unknown>> = [];
const rec = (step: string, proves: string, r: TxResult, expectFail = false) => {
  const good = expectFail ? !r.ok : r.ok;
  evidence.push({ step, proves, ok: r.ok, expected: expectFail ? "refusal" : "success", hash: r.hash, url: r.url, error: r.error });
  console.log(`${good ? "✔" : "✘"} ${step}: ${r.ok ? "ok" : "FAILED"} ${r.hash ? r.url : ""}${r.error ? `\n    ${r.error.slice(0, 220)}` : ""}`);
  if (!good) throw new Error(`${step} did not behave as expected`);
  return r;
};

async function main() {
  if (NETWORK !== "testnet") throw new Error("this script is testnet-only (P-2)");
  const C = contractId();
  console.log(`Plan (network ${NETWORK}, contract ${C}):\n  ${process.argv.includes("--deploy") ? "deploy + init contract; " : ""}register 3 judges, 3 enclaves; 1 treaty via meta-tx; 8 rob attempts; 1 dispute; TEE votes; settlement; Chain Signatures request.\n  Spends roughly 6-7 testnet NEAR from OWNER (contract storage + 3 x 0.6 enclave deposits + gas).`);
  if (!process.argv.includes("--yes")) { console.log("\nNothing signed. Re-run with --yes to execute."); return; }

  const owner = accountFromEnv("OWNER");
  const relayer = process.env.RELAYER_ACCOUNT ? accountFromEnv("RELAYER") : owner;

  if (process.argv.includes("--deploy")) {
    const wasm = readFileSync(new URL("contract/target/near/pactum.wasm", root));
    const kp = process.env.PACTUM_CONTRACT_KEY ? KeyPair.fromString(process.env.PACTUM_CONTRACT_KEY as KeyPairString) : KeyPair.fromRandom("ed25519");
    if (!process.env.PACTUM_CONTRACT_KEY) {
      const envFile = new URL(".env", root);
      writeFileSync(envFile, readFileSync(envFile, "utf8").replace(/^PACTUM_CONTRACT_KEY=.*$/m, `PACTUM_CONTRACT_KEY=${kp.toString()}`));
    }
    const created = await owner.createSubAccount({ accountOrPrefix: C, publicKey: kp.getPublicKey(), nearToTransfer: N(String(Math.ceil(wasm.length / 100_000) + 1.5)) }).then((r) => ({ ok: true, hash: (r as { transaction: { hash: string } }).transaction.hash }), (e) => ({ ok: false, hash: "", error: String(e) }));
    rec("create contract account", "named sub-account for the protocol (A-1)", { ...created, url: EXPLORER + created.hash } as TxResult);
    const contractAcct = agentAccount(C, kp.toString());
    const dep = await contractAcct.signAndSendTransaction({ receiverId: C, actions: [actions.deployContract(wasm), actions.functionCall("new", { owner: owner.accountId, treasury: owner.accountId, quorum: 2, mpc_signer: "v1.signer-prod.testnet" }, teraToGas("100"), 0n)], throwOnFailure: false });
    rec("deploy + init", "contract deployed with quorum 2 and MPC signer v1.signer-prod.testnet", { ok: !(dep.status as { Failure?: unknown }).Failure, hash: dep.transaction.hash, url: EXPLORER + dep.transaction.hash });
  }

  // --- judges (A-5). With NEAR_AI_API_KEY: real attested TEE keys. Otherwise SimTee keys (labeled).
  const apiKey = process.env.NEAR_AI_API_KEY || undefined;
  const seeds = (process.env.SIM_JUDGE_SEEDS ?? "").split(",").filter(Boolean);
  if (!apiKey && seeds.length < 3) throw new Error("run `npm run setup` first (SIM_JUDGE_SEEDS)");
  const panel = makePanel({ apiKey, seeds });
  if ((await view<unknown[]>("list_judges")).length === 0) {
    mkdirSync(new URL("evidence/attestations/", root), { recursive: true });
    for (const j of panel) {
      let addr: string, att: string;
      if (apiKey) {
        const a = await fetchAttestation(j.tee.model, apiKey);
        writeFileSync(new URL(`evidence/attestations/${j.id}.json`, root), a.raw);
        addr = a.signing_address; att = a.sha256;
      } else {
        addr = (j.tee as SimTee).address; att = sha256hex(`sim-attestation:${j.tee.model}`);
      }
      rec(`register judge ${j.id}`, `judge key 0x${addr} (${j.tee.mode}) bound on-chain`, await call(owner, "register_judge", { model: j.tee.model, signing_address: addr, kind: "ProviderTee", attestation_sha256: att }));
    }
  }

  // --- enclaves (A-2, A-3): contract creates sub-accounts holding ONLY a function-call key
  const names = ["atlas", "meridian", "mallory"] as const;
  const ids: Record<string, string> = {};
  for (const n of names) {
    const key = process.env[`${n.toUpperCase()}_AGENT_KEY`];
    if (!key) throw new Error("run `npm run setup` first");
    ids[n] = `${n}.${C}`;
    if (await view("get_enclave", { account: ids[n] })) continue;
    const pub = KeyPair.fromString(key as KeyPairString).getPublicKey().toString();
    const payout = n === "atlas" ? { chain: "base", address: "0x7a11a5000000000000000000000000000000a71a" } : { chain: "near", address: owner.accountId };
    rec(`register enclave ${n}`, `sub-account ${ids[n]} created with fc key ${pub.slice(0, 20)}… (methods + 0.25 NEAR allowance)`, await call(owner, "register_enclave", { name: n, agent_public_key: pub, beneficiary: owner.accountId, payout, max_bond: n === "mallory" ? Ys("0.25") : null, guardian: owner.accountId }, N("0.6"), 150));
  }
  const agent = (n: string) => agentAccount(ids[n], process.env[`${n.toUpperCase()}_AGENT_KEY`]!);
  const keys = await provider.viewAccessKeyList({ accountId: ids.atlas });
  evidence.push({ step: "access keys of atlas enclave", proves: "only a FunctionCall key exists (no full access)", keys: (keys as { keys: unknown[] }).keys });

  // --- treaty via meta transactions (gasless for agents)
  const terms = `Meridian keeps the ETH/USD oracle consumed by Atlas live at >= 98.50% (9850 bps) measured by two independent monitors. Atlas pays 0.05 NEAR per epoch.`;
  const p = rec("propose_treaty (meta-tx)", "atlas proposes; 0.2 NEAR bond moves free->locked; relayer paid gas", await metaCall(agent("atlas"), relayer, "propose_treaty", { counterparty: ids.meridian, terms, bond: Ys("0.2"), counter_bond: Ys("0.3"), duration_ns: String(30 * 86_400e9), notice_ns: String(3_600e9), params: { uptime_floor_bps: 9850 }, telemetry_urls: [] }));
  const treaties = await view<Array<{ id: number; terms_hash: string; status: string }>>("list_treaties", { from: 0, limit: 200 });
  const t = treaties.filter((x) => x.status === "Proposed").at(-1)!;
  void p;
  rec("ratify (meta-tx)", "meridian ratifies exact terms_hash; treaty ACTIVE; 0.3 NEAR escrowed", await metaCall(agent("meridian"), relayer, "ratify", { treaty_id: t.id, terms_hash: t.terms_hash }));

  // --- rob / break attempts: each must FAIL on-chain (RULES.md Part G)
  rec("R-ROB-1 withdraw locked bond", "escrow cannot be withdrawn", await metaCall(agent("meridian"), relayer, "withdraw_free_collateral", { amount: Ys("0.4") }), true);
  rec("R-ROB-2 call set_quorum with agent key", "function-call key method allow-list enforced by the runtime", await metaCall(agent("meridian"), relayer, "set_quorum", { quorum: 1 }), true);
  rec("R-ROB-3 attach deposit with agent key", "function-call keys cannot move NEAR", await metaCall(agent("meridian"), relayer, "deposit_collateral", { enclave: ids.mallory }, N("0.5")), true);
  rec("R-ROB-4 outsider files dispute", "only treaty parties can dispute", await metaCall(agent("mallory"), relayer, "file_dispute", { treaty_id: t.id, allegation: "x", evidence_uri: "https://example.com/x", evidence_sha256: "a".repeat(64), dispute_bond: Ys("0.1") }), true);
  rec("R-ROB-7 ratify altered terms", "ratify must quote the exact terms hash", await metaCall(agent("atlas"), relayer, "ratify", { treaty_id: t.id, terms_hash: "0".repeat(64) }), true);
  rec("R-ROB-8 agent calls owner method", "owner-only admin", await call(relayer === owner ? agentlessOutsider() : relayer, "set_quorum", { quorum: 1 }), true);
  rec("R-ROB-10 bond above self-imposed cap", "mallory capped itself at 0.25 NEAR", await metaCall(agent("mallory"), relayer, "propose_treaty", { counterparty: ids.atlas, terms: "x", bond: Ys("0.3"), counter_bond: Ys("0.1"), duration_ns: "1000", notice_ns: "1" }), true);

  // --- dispute with hash-bound evidence; two independent telemetry hosts
  const servers: Server[] = [];
  const serve = (body: Map<string, string>) => new Promise<string>((ok) => { const s = createServer((q, r) => { const b = body.get(q.url ?? ""); b ? r.writeHead(200).end(b) : r.writeHead(404).end(); }).listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(s.address() as { port: number }).port}`)); servers.push(s); });
  const fa = new Map<string, string>(), fb = new Map<string, string>(), fe = new Map<string, string>();
  const [A, B, E] = await Promise.all([serve(fa), serve(fb), serve(fe)]);
  fa.set("/t.json", JSON.stringify({ [ids.meridian]: { value_bps: 6020 } }));
  fb.set("/t.json", JSON.stringify({ [ids.meridian]: { value_bps: 6110 } }));
  const doc = JSON.stringify({ pactum_evidence: 1, contract: C, treaty_id: t.id, accused: ids.meridian, metric: "uptime_floor_bps", baseline_bps: 9850, feeds: [`${A}/t.json`, `${B}/t.json`], narrative: "ETH/USD feed stale 9h41m during a 14% drawdown." });
  fe.set("/incident.json", doc);
  mkdirSync(new URL("telemetry/", root), { recursive: true });
  writeFileSync(new URL(`telemetry/incident-${t.id}.json`, root), doc);
  const evidenceUri = process.env.EVIDENCE_PUBLIC_BASE ? `${process.env.EVIDENCE_PUBLIC_BASE}/incident-${t.id}.json` : `https://example.invalid/pactum/incident-${t.id}.json`;
  rec("file_dispute (meta-tx)", `atlas commits to evidence sha256 ${sha256hex(doc).slice(0, 16)}…`, await metaCall(agent("atlas"), relayer, "file_dispute", { treaty_id: t.id, allegation: "Oracle down most of epoch 812; vault could not liquidate.", evidence_uri: evidenceUri, evidence_sha256: sha256hex(doc), dispute_bond: Ys("0.1") }));
  const d = (await view<Array<{ id: number; treaty_id: number; plaintiff: string; defendant: string; allegation: string; evidence_uri: string; evidence_sha256: string; status: string }>>("list_disputes", { from: 0, limit: 200 })).filter((x) => x.status === "Open").at(-1)!;

  // Judges fetch the same bytes from the local hosts (labeled in evidence; hash is identical).
  const local = httpFetcher(true);
  const fetcher = async (u: string) => (u === d.evidence_uri ? local(`${E}/incident.json`) : local(u));
  const votes = await Promise.all(panel.map((j) => judgeVote(j, d, terms, C, fetcher)));
  servers.forEach((s) => s.close());
  evidence.push({ step: "judge votes", proves: "TEE-format signatures over exact request/response bytes", evidence_source: "local hosts, same bytes as telemetry/ (sha256 matches)", votes: votes.map(({ parsed, ...v }) => v) });

  // forged + tampered submissions must fail, then the honest set succeeds
  rec("R-ROB-5 forged / duplicated votes", "duplicate judge counts once; wrong key ignored", await call(relayer, "submit_verdicts", { dispute_id: d.id, votes: [votes[0], votes[0], { ...votes[0], judge_id: 1 }].map(strip) }, 0n, 300), true);
  rec("R-ROB-6 replayed vote", "votes are bound to dispute id + evidence hash", await call(relayer, "submit_verdicts", { dispute_id: d.id, votes: [{ ...votes[0], request_body: votes[0].request_body.replace(`|${d.id}|`, `|${d.id + 1}|`) }, votes[1]].map(strip) }, 0n, 300), true);
  const ruling = rec("submit_verdicts", "ecrecover of each TEE signature on-chain; quorum 2/3; clamp; settlement", await call(relayer, "submit_verdicts", { dispute_id: d.id, votes: votes.map(strip) }, 0n, 300));
  console.log(`ruling: ${JSON.stringify(ruling.value)}`);

  // --- Chain Signatures (S-6): atlas's payout target is Base -> pending payout -> MPC sign
  const payouts = await view<Array<{ id: number; status: string; target: object; amount: string; path: string }>>("list_payouts", { from: 0, limit: 200 });
  const pend = payouts.find((x) => x.status === "Pending");
  if (pend) {
    const payload = sha256hex(JSON.stringify({ contract: C, payout: pend.id, target: pend.target, amount: pend.amount }));
    rec("Chain Signatures sign()", `v1.signer-prod.testnet signs payout ${pend.id} (path ${pend.path})`, await call(owner, "request_payout_signature", { payout_id: pend.id, payload_hex: payload }, 1n, 300));
  }
  evidence.push({ step: "final state", enclaves: await view("list_enclaves", { from: 0, limit: 50 }), audit: await view("audit") });

  mkdirSync(new URL("evidence/", root), { recursive: true });
  writeFileSync(new URL("evidence/testnet-evidence.json", root), JSON.stringify({ network: NETWORK, contract: C, generated: new Date().toISOString(), items: evidence }, null, 2));
  console.log("\nwrote evidence/testnet-evidence.json");
}

const strip = (v: { judge_id: number; request_body: string; response_body: string; signature: string }) => ({ judge_id: v.judge_id, request_body: v.request_body, response_body: v.response_body, signature: v.signature });
/** An enclave-less account for R-ROB-8 when relayer == owner: use the mallory enclave key as a direct (non-meta) caller. */
function agentlessOutsider() {
  return agentAccount(`mallory.${contractId()}`, process.env.MALLORY_AGENT_KEY!);
}

main().catch((e) => { console.error(e); process.exit(1); });
