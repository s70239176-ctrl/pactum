// `npm run setup`: generates local keys into ../.env (git-ignored, P-3):
//   - one ed25519 function-call key per agent enclave (added on-chain by register_enclave)
//   - three secp256k1 seeds for simulated TEE judges on testnet
// Never prints private keys. Never overwrites existing values.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import { addressOf } from "./tee.ts";

const envPath = new URL("../../.env", import.meta.url);
const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
const has = (k: string) => new RegExp(`^${k}=.+$`, "m").test(env);
const set = (src: string, k: string, v: string) => (new RegExp(`^${k}=.*$`, "m").test(src) ? src.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${src.trimEnd()}\n${k}=${v}\n`);

let out = env;
for (const a of ["ATLAS", "MERIDIAN", "MALLORY"]) {
  if (has(`${a}_AGENT_KEY`)) continue;
  const kp = KeyPair.fromRandom("ed25519");
  out = set(out, `${a}_AGENT_KEY`, kp.toString());
  console.log(`${a}: function-call public key ${kp.getPublicKey().toString()}`);
}
if (!has("SIM_JUDGE_SEEDS")) {
  const seeds = [0, 1, 2].map(() => randomBytes(32).toString("hex"));
  out = set(out, "SIM_JUDGE_SEEDS", seeds.join(","));
  seeds.forEach((s, i) => console.log(`sim judge ${i}: signing_address 0x${addressOf(Uint8Array.from(Buffer.from(s, "hex")))}`));
}
writeFileSync(envPath, out);
console.log("\nkeys written to .env (git-ignored). Fill OWNER_ACCOUNT / OWNER_KEY yourself.");
