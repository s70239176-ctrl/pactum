// `npm run verify [file]`: independently re-checks every judge vote in an evidence
// file: the TEE signature recovers to the registered signing_address, the request
// carries the dispute binding, and the quorum matches the recorded ruling (X-3).
import { readFileSync } from "node:fs";
import { verifyVote, sha256hex, type TeeVote, type SignatureKind } from "./tee.ts";

const file = process.argv[2] ?? new URL("../../evidence/sim-evidence.json", import.meta.url);
const ev = JSON.parse(readFileSync(file, "utf8"));
const judges: Array<{ id: number; model: string; signing_address: string; kind: SignatureKind }> = ev.judges;
let fail = 0;
for (const item of ev.items) {
  if (item.kind !== "dispute") {
    console.log(`${item.refused ? "✔" : "✘"} ${item.rule} refused: ${item.message ?? "NO"}`);
    if (!item.refused) fail++;
    continue;
  }
  const ok = (item.votes as TeeVote[]).map((v) => {
    const j = judges[v.judge_id];
    const good = verifyVote(v, j, item.binding);
    const content = JSON.parse(v.response_body).choices[0].message.content;
    console.log(`  ${good ? "✔" : "✘"} dispute ${item.dispute_id} judge ${v.judge_id} (${j.model}) signer 0x${j.signing_address} resp sha256 ${sha256hex(v.response_body).slice(0, 12)}… -> ${JSON.parse(content).verdict}`);
    return good ? JSON.parse(content).verdict : null;
  });
  const quorumVerdict = ok.find((v) => v && ok.filter((o) => o === v).length >= 2);
  const match = quorumVerdict === item.ruling.raw;
  console.log(`${match ? "✔" : "✘"} dispute ${item.dispute_id}: quorum verdict ${quorumVerdict} == recorded ${item.ruling.raw} (final ${item.ruling.final})`);
  if (!match) fail++;
}
console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
