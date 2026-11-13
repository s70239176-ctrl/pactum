// `npm run live:setup -- --yes`: one-time setup for "Hire an agent" (the live, playable market).
// Runs on the owner machine only; the owner key never leaves it.
//  1. Discover NEAR AI Cloud TEE nodes for each judge model (one attestation report per call) and
//     register every node key not yet on-chain, each proven by its own attestation report (A-5, X-4).
//  2. Create the house provider enclave `house.<contract>` (function-call key only) with collateral.
//  3. Create a small relay account that pays gas for submit_verdicts / conclude on Vercel.
// New keys are appended to .env (git-ignored) and copied to Vercel as secrets by the human.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { KeyPair, actions, nearToYocto } from "near-api-js";
import { accountFromEnv, call, provider, view, contractId, NETWORK, EXPLORER } from "./chain.ts";
import { PANEL } from "./judge.ts";
import { fetchAttestation } from "./tee.ts";

const root = new URL("../../", import.meta.url);
if (existsSync(new URL(".env", root))) process.loadEnvFile(new URL(".env", root));
const yes = process.argv.includes("--yes");
const HOUSE_COLLATERAL = process.env.HOUSE_COLLATERAL ?? "1.0";
const RELAY_FUNDING = process.env.RELAY_FUNDING ?? "0.4";
const SAMPLES = Number(process.env.ATTEST_SAMPLES ?? 12);

async function main() {
  if (NETWORK !== "testnet") throw new Error("testnet only");
  const C = contractId();
  const key = (process.env.NEAR_AI_API_KEY ?? "").trim();
  if (!key) throw new Error("NEAR_AI_API_KEY missing");
  const owner = accountFromEnv("OWNER");

  // 1. TEE nodes
  const onchain = await view<Array<{ id: number; model: string; signing_address: string; active: boolean }>>("list_judges");
  for (const p of PANEL) {
    const seen = new Map<string, Awaited<ReturnType<typeof fetchAttestation>>>();
    for (let i = 0; i < SAMPLES; i++) {
      try { const a = await fetchAttestation(p.model, key); if (a.signing_address && !seen.has(a.signing_address)) seen.set(a.signing_address, a); } catch (e) { console.log(`  attestation ${p.model}: ${(e as Error).message}`); }
    }
    for (const [addr, att] of seen) {
      const have = onchain.find((j) => j.model === p.model && j.signing_address === addr && j.active);
      console.log(`${p.model} node 0x${addr}: ${have ? `already judge #${have.id}` : "NEW"}`);
      if (have || !yes) continue;
      mkdirSync(new URL("evidence/attestations/", root), { recursive: true });
      writeFileSync(new URL(`evidence/attestations/${p.model.replace(/[^a-z0-9.-]+/gi, "_")}-${addr.slice(0, 8)}.json`, root), att.raw);
      const r = await call(owner, "register_judge", { model: p.model, signing_address: addr, kind: "ProviderTee", attestation_sha256: att.sha256 });
      console.log(`  register_judge: ${r.ok ? "ok" : "FAILED " + r.error} ${r.url}`);
    }
  }

  // 2. house enclave
  const house = `house.${C}`;
  const hv = await view<unknown>("get_enclave", { account: house });
  if (hv) console.log(`house enclave ${house} exists`);
  else if (yes) {
    const kp = KeyPair.fromRandom("ed25519");
    const dep = nearToYocto("0.1") + nearToYocto(HOUSE_COLLATERAL);
    const r = await call(owner, "register_enclave", { name: "house", agent_public_key: kp.getPublicKey().toString(), beneficiary: owner.accountId, payout: { chain: "near", address: owner.accountId }, max_bond: null, guardian: owner.accountId }, dep, 150);
    console.log(`register_enclave house: ${r.ok ? "ok" : "FAILED " + r.error} ${r.url}`);
    if (r.ok) appendFileSync(new URL(".env", root), `\n# Hire an agent: house provider enclave (function-call key only)\nHOUSE_ACCOUNT=${house}\nHOUSE_KEY=${kp.toString()}\n`);
  } else console.log(`would create ${house} with ${HOUSE_COLLATERAL} NEAR collateral`);

  // 3. relay account
  const relay = `relay.${owner.accountId}`;
  let exists = true;
  try { await provider.viewAccount({ accountId: relay }); } catch { exists = false; }
  if (exists) console.log(`relay ${relay} exists`);
  else if (yes) {
    const kp = KeyPair.fromRandom("ed25519");
    const r = await owner.signAndSendTransaction({ receiverId: relay, actions: [actions.createAccount(), actions.transfer(nearToYocto(RELAY_FUNDING)), actions.addFullAccessKey(kp.getPublicKey())], throwOnFailure: false });
    const h = (r as { transaction?: { hash?: string } }).transaction?.hash;
    console.log(`create ${relay}: ${EXPLORER}${h}`);
    appendFileSync(new URL(".env", root), `# Hire an agent: relay that pays gas for submit_verdicts / conclude\nLIVE_RELAY_ACCOUNT=${relay}\nLIVE_RELAY_KEY=${kp.toString()}\n`);
  } else console.log(`would create ${relay} with ${RELAY_FUNDING} NEAR`);
  if (!yes) console.log("\nNothing signed. Re-run with --yes to execute.");
}
main().catch((e) => { console.error(e); process.exit(1); });
