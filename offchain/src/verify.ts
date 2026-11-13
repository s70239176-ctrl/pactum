// `npm run verify [file]`: independently re-checks every judge vote in the SIMULATION
// evidence files (default: evidence/sim-evidence.json + evidence/markets-evidence.json):
// the TEE-format signature recovers to the registered signing_address, the request
// carries the dispute binding, and the quorum matches the recorded ruling (RULES X-3).
// For the real testnet record, use `npm run audit:evidence`.
import { readFileSync } from "node:fs";
import { verifyVote, type TeeVote, type SignatureKind } from "./tee.ts";

const files = process.argv[2] ? [process.argv[2]] : ["sim-evidence.json", "markets-evidence.json"].map((f) => new URL(`../../evidence/${f}`, import.meta.url));
let fail = 0;

for (const file of files) {
  console.log(`\n== ${String(file).split("/").pop()} (simulation)`);
  const ev = JSON.parse(readFileSync(file, "utf8"));
  const judges: Array<{ id: number; model: string; signing_address: string; kind: SignatureKind }> = ev.judges;
  for (const item of ev.items) {
    if (item.kind !== "dispute") {
      console.log(`${item.refused ? "✔" : "✘"} ${item.rule} refused: ${item.message ?? "NO"}`);
      if (!item.refused) fail++;
      continue;
    }
    const verdicts = (item.votes as TeeVote[]).map((v) => {
      const j = judges[v.judge_id];
      const good = verifyVote(v, j, item.binding);
      const verdict = JSON.parse(JSON.parse(v.response_body).choices[0].message.content).verdict;
      console.log(`  ${good ? "✔" : "✘"} dispute ${item.dispute_id} judge ${v.judge_id} (${j.model}) signer 0x${j.signing_address.slice(0, 10)}… -> ${verdict}`);
      return good ? verdict : null;
    });
    const quorum = verdicts.find((v) => v && verdicts.filter((o) => o === v).length >= 2);
    const match = quorum === item.ruling.raw;
    console.log(`${match ? "✔" : "✘"} dispute ${item.dispute_id}: quorum verdict ${quorum} == recorded ${item.ruling.raw} (final ${item.ruling.final})`);
    if (!match) fail++;
  }
}
console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
