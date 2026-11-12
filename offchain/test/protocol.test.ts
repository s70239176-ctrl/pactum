import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SimTee, signEip191, recoverEip191, addressOf, teeText, verifyVote, binding, sha256hex } from "../src/tee.ts";
import { intake, safeUrl } from "../src/evidence.ts";
import { judgeVote, simAnswer, type PanelMember } from "../src/judge.ts";
import { Ledger, Y, Refusal } from "../src/ledger.ts";

const A = "a".repeat(64), B = "b".repeat(64);
const seed = (b: string) => Uint8Array.from(Buffer.from(b.repeat(32), "hex"));

test("well-known address for key 0x01..01 (EIP-191 key derivation)", () => {
  assert.equal(addressOf(seed("01")), "1a642f0e3c3af545e7acbd38b07251b3990914f1");
});

test("EIP-191 sign/recover round trip; tamper is detected", () => {
  const sig = signEip191("m:x:y", seed("07"));
  assert.equal(recoverEip191("m:x:y", sig), addressOf(seed("07")));
  assert.notEqual(recoverEip191("m:x:z", sig), addressOf(seed("07")));
});

test("TS-signed fixture matches the one the Rust contract verifies", () => {
  const f = JSON.parse(readFileSync(new URL("../../contract/src/fixtures/ts_vote.json", import.meta.url), "utf8"));
  assert.ok(verifyVote(f, { model: f.model, signing_address: f.signing_address, kind: "ProviderTee" }, binding("pactum.testnet", 0, B)));
});

test("tee text format follows docs.near.ai chat verification", () => {
  assert.equal(teeText("ProviderTee", "m", "q", "r"), `m:${sha256hex("q")}:${sha256hex("r")}`);
  assert.equal(teeText("Gateway", "m", "q", "r"), `${sha256hex("q")}:${sha256hex("r")}`);
});

const doc = (o: object = {}) => JSON.stringify({ pactum_evidence: 1, contract: "c.testnet", treaty_id: 3, accused: "bob.testnet", metric: "uptime", baseline_bps: 9900, feeds: ["https://a.example/f", "https://b.example/f"], narrative: "outage", ...o });
const files = (m: Record<string, string>) => async (u: string) => { if (!(u in m)) throw new Error("404"); return new TextEncoder().encode(m[u]); };
const feeds = (a: number, b: number) => ({ "https://a.example/f": JSON.stringify({ "bob.testnet": { value_bps: a } }), "https://b.example/f": JSON.stringify({ "bob.testnet": { value_bps: b } }) });
const disp = (d: string) => ({ id: 1, treaty_id: 3, plaintiff: "alice.testnet", defendant: "bob.testnet", allegation: "x", evidence_uri: "https://e.example/d", evidence_sha256: sha256hex(d) });

test("D-3 intake: hash, binding, feeds", async () => {
  const d = doc();
  const ok = await intake({ ...disp(d), evidence_hash: sha256hex(d) }, "c.testnet", files({ "https://e.example/d": d, ...feeds(6000, 6100) }));
  assert.ok(ok.ok && ok.shortfallBps === 3889);
  const bad = await intake({ ...disp(d), evidence_hash: A }, "c.testnet", files({ "https://e.example/d": d }));
  assert.equal(!bad.ok && bad.reason, "NO_EVIDENCE");
  const conflict = await intake({ ...disp(d), evidence_hash: sha256hex(d) }, "c.testnet", files({ "https://e.example/d": d, ...feeds(6000, 9000) }));
  assert.equal(!conflict.ok && conflict.reason, "FEED_CONFLICT");
  const wrong = doc({ accused: "carol.testnet" });
  const r = await intake({ ...disp(wrong), evidence_hash: sha256hex(wrong) }, "c.testnet", files({ "https://e.example/d": wrong }));
  assert.equal(!r.ok && r.reason, "NO_EVIDENCE");
});

test("SSRF guard", () => {
  for (const u of ["http://example.com", "https://127.0.0.1/x", "https://10.1.2.3/", "https://100.64.0.1/", "https://localhost./"]) assert.throws(() => safeUrl(u), u);
});

test("judge -> signed vote -> ledger quorum + rob refusals", async () => {
  const L = new Ledger("c.testnet", 2);
  const panel: PanelMember[] = ["01", "02", "03"].map((s, id) => ({ id, name: `j${id}`, persona: "", tee: SimTee.fromSeed(`sim/m${id}`, s.repeat(32), simAnswer(0)) }));
  panel.forEach((j) => L.register_judge(j.tee.model, (j.tee as SimTee).address, A));
  const a = L.register_enclave("alice", "ops.testnet", { chain: "near", address: "a.testnet" }, Y(10));
  const b = L.register_enclave("bob", "ops.testnet", { chain: "near", address: "b.testnet" }, Y(10));
  const t = L.propose_treaty(a, b, "terms", Y(1), Y(2));
  L.ratify(b, t.id, t.terms_hash);
  assert.throws(() => L.withdraw_free_collateral(b, Y(9)), Refusal);
  const d0 = doc({ accused: b, treaty_id: t.id });
  const d = L.file_dispute(a, t.id, "x", "https://e.example/d", sha256hex(d0), Y(0.5));
  const fe = files({ "https://e.example/d": d0, "https://a.example/f": JSON.stringify({ [b]: { value_bps: 6000 } }), "https://b.example/f": JSON.stringify({ [b]: { value_bps: 6050 } }) });
  const votes = await Promise.all(panel.map((j) => judgeVote(j, { ...d }, "terms", "c.testnet", fe)));
  assert.throws(() => L.submit_verdicts(d.id, [votes[0], votes[0]]), /no quorum/);
  const r = L.submit_verdicts(d.id, votes);
  assert.equal(r.final, "CRITICAL_BREACH");
  assert.equal(L.treaties[t.id].status, "Closed");
});
