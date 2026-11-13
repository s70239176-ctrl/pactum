// `npm run nearai:check`: proves the NEAR AI Cloud chain of trust OFFLINE (no transactions):
//   attestation report -> signing_address  ==  signer recovered from the chat signature
// over "{model}:{sha256(request)}:{sha256(response)}" (provider_tee) or the gateway form.
// Saves raw attestation reports to evidence/attestations/ (public data, no secrets).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fetchAttestation, NearAiTee, recoverEip191, teeText, sha256hex } from "./tee.ts";
import { PANEL } from "./judge.ts";

const root = new URL("../../", import.meta.url);
if (existsSync(new URL(".env", root))) process.loadEnvFile(new URL(".env", root));
const key = (process.env.NEAR_AI_API_KEY ?? "").trim();
if (!key) throw new Error("NEAR_AI_API_KEY missing in .env");
mkdirSync(new URL("evidence/attestations/", root), { recursive: true });

const results = [];
for (const p of PANEL) {
  const row: Record<string, unknown> = { model: p.model };
  try {
    const att = await fetchAttestation(p.model, key);
    row.attested_signing_address = att.signing_address;
    row.attestation_sha256 = att.sha256;
    const file = `evidence/attestations/check-${p.model.replace(/[^a-z0-9.-]+/gi, "_")}-${att.signing_address.slice(0, 8)}.json`;
    writeFileSync(new URL(file, root), att.raw);
    row.attestation_file = file;

    const tee = new NearAiTee(p.model, key);
    const req = JSON.stringify({ model: p.model, temperature: 0, max_tokens: 2000, chat_template_kwargs: { enable_thinking: false }, messages: [{ role: "user", content: 'Reply ONLY with JSON {"verdict":"NORMAL","metric_bps":0,"rationale":"check"}' }] });
    const r = await tee.complete(req);
    const text = teeText(tee.kind, p.model, req, r.response_body);
    const recovered = recoverEip191(text, r.signature);
    row.signature_kind = tee.kind;
    row.reply_signer = r.signing_address;
    row.recovered = recovered;
    row.response_sha256 = sha256hex(r.response_body);
    row.content = JSON.parse(r.response_body).choices[0].message.content.slice(0, 120);
    row.verified = recovered === r.signing_address && (tee.kind === "Gateway" || recovered === att.signing_address);
  } catch (e) {
    row.error = (e as Error).message.slice(0, 200);
  }
  results.push(row);
  console.log(JSON.stringify(row, null, 1));
}
writeFileSync(new URL("evidence/nearai-check.json", root), JSON.stringify({ checked: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.verified).length}/${results.length} models: TEE signature recovers to the attested signing address`);
