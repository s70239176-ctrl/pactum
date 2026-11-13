// `npm run testnet:judges -- --yes`: a dispute judged by REAL NEAR AI Cloud TEE models on testnet.
// Signs transactions with OWNER / agent keys from .env, so it never runs without --yes (P-1).
//  1. register the 3 NEAR-hosted TEE judges (signing_address + attestation sha256 from the live report)
//  2. deactivate the simulated judges so only TEE signatures can reach quorum
//  3. atlas <-> meridian treaty via meta-tx, hash-bound dispute
//  4. each model judges; its TEE signs; the contract ecrecovers each signature on-chain
// Output: evidence/testnet-real-judges.json (+ copy in frontend/data/).
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { nearToYocto } from "near-api-js";
import { accountFromEnv, agentAccount, call, metaCall, view, contractId, NETWORK, type TxResult } from "./chain.ts";
import { makePanel, judgeVote } from "./judge.ts";
import { httpFetcher } from "./evidence.ts";
import { fetchAttestation, sha256hex } from "./tee.ts";

const root = new URL("../../", import.meta.url);
if (existsSync(new URL(".env", root))) process.loadEnvFile(new URL(".env", root));
const Ys = (n: string) => nearToYocto(n).toString();
const items: Array<Record<string, unknown>> = [];
const rec = (step: string, proves: string, r: TxResult, expectFail = false) => {
  items.push({ step, proves, ok: r.ok, expected: expectFail ? "refusal" : "success", hash: r.hash, url: r.url, error: r.error, value: r.value });
  const good = expectFail ? !r.ok : r.ok;
  console.log(`${good ? "✔" : "✘"} ${step}: ${r.ok ? "ok" : "FAILED"} ${r.url ?? ""}${r.error ? `\n    ${String(r.error).slice(0, 240)}` : ""}`);
  if (!good) throw new Error(`${step} did not behave as expected`);
  return r;
};

async function main() {
  if (NETWORK !== "testnet") throw new Error("testnet only");
  const C = contractId();
  const key = (process.env.NEAR_AI_API_KEY ?? "").trim();
  if (!key) throw new Error("NEAR_AI_API_KEY missing");
  console.log(`Plan (contract ${C}): register 3 NEAR AI Cloud TEE judges; deactivate 3 simulated judges; 1 treaty (0.1/0.1 NEAR) + 1 dispute (0.1 NEAR) via meta-tx; real TEE votes; on-chain ruling.\n  About 10 transactions, under 0.1 testnet NEAR in gas from OWNER. Bonds come from enclave collateral already in the contract.`);
  if (!process.argv.includes("--yes")) { console.log("\nNothing signed. Re-run with --yes to execute."); return; }

  const owner = accountFromEnv("OWNER");
  const relayer = process.env.RELAYER_ACCOUNT ? accountFromEnv("RELAYER") : owner;
  const panel = makePanel({ apiKey: key, seeds: [] });

  // 1-2. judges
  const existing = await view<Array<{ id: number; model: string; signing_address: string; active: boolean }>>("list_judges");
  const ids: number[] = [];
  for (const j of panel) {
    const have = existing.find((e) => e.model === j.tee.model && e.active);
    if (have) { ids.push(have.id); continue; }
    const att = await fetchAttestation(j.tee.model, key);
    writeFileSync(new URL(`evidence/attestations/${j.tee.model.replace(/[^a-z0-9.-]+/gi, "_")}-${att.signing_address.slice(0, 8)}.json`, root), att.raw);
    const found = existing.find((e) => e.model === j.tee.model && e.signing_address === att.signing_address && e.active);
    if (found) { ids.push(found.id); continue; }
    const r = rec(`register TEE judge ${j.tee.model}`, `attested signing_address 0x${att.signing_address}, attestation sha256 ${att.sha256.slice(0, 16)}…`, await call(owner, "register_judge", { model: j.tee.model, signing_address: att.signing_address, kind: "ProviderTee", attestation_sha256: att.sha256 }));
    ids.push(Number(r.value));
  }
  for (const e of existing.filter((x) => x.model.startsWith("sim/") && x.active)) {
    rec(`deactivate simulated judge ${e.id}`, "only TEE-attested judges can reach quorum", await call(owner, "set_judge_active", { judge_id: e.id, active: false }));
  }
  panel.forEach((j, i) => (j.id = ids[i])); // on-chain judge ids

  // 3. treaty + dispute via meta transactions (or resume an already-open dispute)
  const atlas = agentAccount(`atlas.${C}`, process.env.ATLAS_AGENT_KEY!);
  const meridian = agentAccount(`meridian.${C}`, process.env.MERIDIAN_AGENT_KEY!);
  const terms = "Meridian keeps the BTC/USD oracle consumed by Atlas live at >= 99.00% (9900 bps), measured by two independent monitors. Atlas pays 0.01 NEAR per epoch.";
  const FEEDS: [number, number] = [7120, 7055];
  type DisputeV = { id: number; treaty_id: number; plaintiff: string; defendant: string; allegation: string; evidence_uri: string; evidence_sha256: string; status: string };
  const listOpen = async () => (await view<DisputeV[]>("list_disputes", { from: 0, limit: 500 })).filter((x) => x.status === "Open");

  const servers: Server[] = [];
  const serveAt = (m: Map<string, string>, port = 0) => new Promise<string>((ok) => { const s = createServer((q, r) => { const b = m.get(q.url ?? ""); b ? r.writeHead(200).end(b) : r.writeHead(404).end(); }).listen(port, "127.0.0.1", () => ok(`http://127.0.0.1:${(s.address() as { port: number }).port}`)); servers.push(s); });
  const fa = new Map<string, string>(), fb = new Map<string, string>(), fe = new Map<string, string>();
  let d = (await listOpen()).at(-1);
  let doc: string;
  let E: string;

  if (d && existsSync(new URL(`telemetry/incident-${d.treaty_id}.json`, root))) {
    // Resume: same evidence bytes, feeds re-served on the exact URLs the evidence names.
    doc = (await import("node:fs")).readFileSync(new URL(`telemetry/incident-${d.treaty_id}.json`, root), "utf8");
    if (sha256hex(doc) !== d.evidence_sha256) throw new Error("saved evidence does not match the on-chain hash; cannot resume");
    const feeds: string[] = JSON.parse(doc).feeds;
    await serveAt(fa, Number(new URL(feeds[0]).port));
    await serveAt(fb, Number(new URL(feeds[1]).port));
    console.log(`resuming open dispute #${d.id} (treaty #${d.treaty_id}); evidence hash matches`);
    items.push({ step: "resume", proves: `dispute #${d.id} was filed in an earlier attempt; same evidence bytes re-served` });
  } else {
    rec("propose_treaty (meta-tx)", "atlas bonds 0.1 NEAR", await metaCall(atlas, relayer, "propose_treaty", { counterparty: `meridian.${C}`, terms, bond: Ys("0.1"), counter_bond: Ys("0.1"), duration_ns: String(30 * 86_400e9), notice_ns: String(3_600e9), params: { uptime_floor_bps: 9900 }, telemetry_urls: [] }));
    const t = (await view<Array<{ id: number; terms_hash: string; status: string }>>("list_treaties", { from: 0, limit: 500 })).filter((x) => x.status === "Proposed").at(-1)!;
    rec("ratify (meta-tx)", "meridian bonds 0.1 NEAR; treaty ACTIVE", await metaCall(meridian, relayer, "ratify", { treaty_id: t.id, terms_hash: t.terms_hash }));
    const A = await serveAt(fa), B = await serveAt(fb);
    doc = JSON.stringify({ pactum_evidence: 1, contract: C, treaty_id: t.id, accused: `meridian.${C}`, metric: "uptime_floor_bps", baseline_bps: 9900, feeds: [`${A}/t.json`, `${B}/t.json`], narrative: "BTC/USD feed returned stale prices for 6h50m across two epochs; both monitors logged the outage. Atlas paused borrowing to avoid bad debt." });
    mkdirSync(new URL("telemetry/", root), { recursive: true });
    writeFileSync(new URL(`telemetry/incident-${t.id}.json`, root), doc);
    rec("file_dispute (meta-tx)", `evidence sha256 ${sha256hex(doc).slice(0, 16)}… committed`, await metaCall(atlas, relayer, "file_dispute", { treaty_id: t.id, allegation: "BTC/USD oracle stale for 6h50m; covenant floor 99% breached.", evidence_uri: `https://example.invalid/pactum/incident-${t.id}.json`, evidence_sha256: sha256hex(doc), dispute_bond: Ys("0.1") }));
    d = (await listOpen()).at(-1)!;
  }
  fa.set("/t.json", JSON.stringify({ [`meridian.${C}`]: { value_bps: FEEDS[0] } }));
  fb.set("/t.json", JSON.stringify({ [`meridian.${C}`]: { value_bps: FEEDS[1] } }));
  fe.set("/incident.json", doc);
  E = await serveAt(fe);

  // 4. real TEE judging
  const local = httpFetcher(true);
  const fetcher = async (u: string) => (u === d!.evidence_uri ? local(`${E}/incident.json`) : local(u));
  // A model can be served by several TEE nodes, each with its own attested key.
  const voteWithRetry = async (j: (typeof panel)[number]) => {
    for (let i = 0; i < 4; i++) {
      try { return await judgeVote(j, d!, terms, C, fetcher); }
      catch (e) { console.log(`  ${j.tee.model}: ${(e as Error).message}; retry ${i + 1}/4`); await new Promise((ok) => setTimeout(ok, 15_000)); }
    }
    return null;
  };
  const raw = (await Promise.all(panel.map(voteWithRetry))).filter((v): v is NonNullable<typeof v> => !!v);
  servers.forEach((s) => s.close());
  // Bind each vote to the on-chain judge whose registered key signed it; register a new node
  // only after fetching an attestation report that names exactly that signing address.
  let onchain = await view<Array<{ id: number; model: string; signing_address: string; active: boolean }>>("list_judges");
  const votes: typeof raw = [];
  for (const v of raw) {
    let j = onchain.find((x) => x.active && x.model === v.model && x.signing_address === v.signer);
    if (!j) {
      let att: Awaited<ReturnType<typeof fetchAttestation>> | null = null;
      for (let i = 0; i < 10 && !att; i++) { const a = await fetchAttestation(v.model, key); if (a.signing_address === v.signer) att = a; }
      if (!att) { console.log(`  dropping ${v.model} vote: signer 0x${v.signer} not found in 10 attestation reports`); continue; }
      writeFileSync(new URL(`evidence/attestations/${v.model.replace(/[^a-z0-9.-]+/gi, "_")}-${v.signer.slice(0, 8)}.json`, root), att.raw);
      rec(`register TEE node ${v.model}`, `node key 0x${v.signer} proven by its own attestation report`, await call(owner, "register_judge", { model: v.model, signing_address: v.signer, kind: "ProviderTee", attestation_sha256: att.sha256 }));
      onchain = await view("list_judges");
      j = onchain.find((x) => x.active && x.model === v.model && x.signing_address === v.signer)!;
    }
    votes.push({ ...v, judge_id: j.id });
  }
  for (const v of votes) console.log(`  ${v.mode} judge ${v.judge_id}: ${JSON.stringify(v.parsed)} (response ${v.response_body.length} bytes)`);
  items.push({ step: "judge votes", proves: "NEAR AI Cloud TEE signatures over exact request/response bytes", evidence_source: "local hosts; same bytes as telemetry/ (sha256 matches)", votes: votes.map(({ parsed, ...v }) => ({ ...v, parsed })) });
  const tooBig = votes.filter((v) => v.response_body.length > 12_000 || v.request_body.length > 12_000);
  if (tooBig.length) console.log(`  warning: ${tooBig.length} vote(s) exceed the contract's 12 KB body limit and will be ignored on-chain`);
  const strip = (v: (typeof votes)[number]) => ({ judge_id: v.judge_id, request_body: v.request_body, response_body: v.response_body, signature: v.signature });
  const ruling = rec("submit_verdicts", "ecrecover of each NEAR AI Cloud TEE signature on-chain; 2-of-3 quorum; clamp; settlement", await call(relayer, "submit_verdicts", { dispute_id: d.id, votes: votes.map(strip) }, 0n, 300));
  console.log(`ruling: ${JSON.stringify(ruling.value)}`);
  items.push({ step: "final dispute", dispute: await view("get_dispute", { dispute_id: d.id }), judges: await view("list_judges"), audit: await view("audit") });

  const out = new URL("evidence/testnet-real-judges.json", root);
  writeFileSync(out, JSON.stringify({ network: NETWORK, contract: C, generated: new Date().toISOString(), items }, null, 2));
  copyFileSync(out, new URL("frontend/data/testnet-real-judges.json", root));
  console.log("\nwrote evidence/testnet-real-judges.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
