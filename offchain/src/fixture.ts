// Writes contract/src/fixtures/ts_vote.json: a vote signed by the TypeScript SimTee,
// which the Rust contract test `ts_signed_vote_verifies_on_chain` must accept.
import { mkdirSync, writeFileSync } from "node:fs";
import { SimTee, binding } from "./tee.ts";

const EVID = "b".repeat(64);
const tee = SimTee.fromSeed("sim/fixture-model", "11".repeat(32), () => ({ verdict: "CRITICAL_BREACH", metric_bps: 4000, rationale: "fixture" }));
const request_body = JSON.stringify({ model: tee.model, messages: [{ role: "user", content: `${binding("pactum.testnet", 0, EVID)} judge` }] });
const r = await tee.complete(request_body);
const dir = new URL("../../contract/src/fixtures/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("ts_vote.json", dir), JSON.stringify({ model: tee.model, signing_address: tee.address, judge_id: 0, request_body, response_body: r.response_body, signature: r.signature }, null, 2));
console.log(`fixture signer 0x${tee.address}`);
