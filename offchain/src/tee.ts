// TEE vote plumbing. A vote is the exact request/response bytes exchanged with a
// NEAR AI Cloud model, plus the TEE's EIP-191 secp256k1 signature over
//   "{model}:{sha256(request)}:{sha256(response)}"        (signature_kind = provider_tee)
// Source: docs.near.ai/cloud/verification/chat (via near/agent-skills near-ai-cloud).
// The Pactum contract re-derives this text and recovers the signer with ecrecover.
//
// SimTee produces byte-identical votes with a local key so `sim` mode needs no LLM.
import { createHash, randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

export const NEAR_AI_BASE = process.env.NEAR_AI_BASE ?? "https://cloud-api.near.ai/v1";

export const sha256hex = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

export interface TeeVote {
  judge_id: number;
  request_body: string;
  response_body: string;
  signature: string; // 0x r||s||v
}

export type SignatureKind = "ProviderTee" | "Gateway";

export const binding = (contract: string, disputeId: number, evidenceSha256: string) =>
  `pactum:v1|${contract}|${disputeId}|${evidenceSha256}`;

export function teeText(kind: SignatureKind, model: string, req: string, resp: string) {
  const r = `${sha256hex(req)}:${sha256hex(resp)}`;
  return kind === "ProviderTee" ? `${model}:${r}` : r;
}

const eip191 = (text: string) => {
  const body = Buffer.from(text, "utf8");
  return keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`, "utf8"), body]));
};

export function addressOf(secretKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(secretKey, false); // 65 bytes, 0x04 prefix
  return toHex(keccak_256(pub.subarray(1)).subarray(12));
}

export function signEip191(text: string, secretKey: Uint8Array): string {
  const rec = secp256k1.sign(eip191(text), secretKey, { prehash: false, format: "recovered" }); // [v, r, s]
  return "0x" + toHex(rec.subarray(1)) + (27 + rec[0]).toString(16).padStart(2, "0");
}

export function recoverEip191(text: string, sigHex: string): string | null {
  try {
    const b = fromHex(sigHex);
    if (b.length !== 65) return null;
    let v = b[64];
    if (v >= 27) v -= 27;
    const rec = new Uint8Array(65);
    rec[0] = v;
    rec.set(b.subarray(0, 64), 1);
    const pub = secp256k1.Signature.fromBytes(rec, "recovered").recoverPublicKey(eip191(text)).toBytes(false);
    return toHex(keccak_256(pub.subarray(1)).subarray(12));
  } catch {
    return null;
  }
}

/** Contract-equivalent check of one vote (D-5). */
export function verifyVote(v: TeeVote, judge: { model: string; signing_address: string; kind: SignatureKind }, bind: string): boolean {
  if (!v.request_body.includes(bind)) return false;
  const addr = recoverEip191(teeText(judge.kind, judge.model, v.request_body, v.response_body), v.signature);
  return addr === judge.signing_address.replace(/^0x/, "").toLowerCase();
}

export interface Tee {
  model: string;
  kind: SignatureKind;
  mode: "simulation" | "near-ai-cloud";
  /** Sends `requestBody` to the model and returns exact bytes + TEE signature. */
  complete(requestBody: string): Promise<{ response_body: string; signature: string; signing_address: string }>;
}

/** Deterministic local stand-in: same wire format, local key, scripted answer. */
export class SimTee implements Tee {
  kind: SignatureKind = "ProviderTee";
  mode = "simulation" as const;
  model: string;
  private sk: Uint8Array;
  private answer: (req: string) => object;
  constructor(model: string, sk: Uint8Array, answer: (req: string) => object) {
    this.model = model;
    this.sk = sk;
    this.answer = answer;
  }
  static fromSeed(model: string, seedHex: string, answer: (req: string) => object) {
    return new SimTee(model, fromHex(seedHex), answer);
  }
  get address() {
    return addressOf(this.sk);
  }
  async complete(requestBody: string) {
    const content = JSON.stringify(this.answer(requestBody));
    const response_body = JSON.stringify({ id: `sim-${sha256hex(requestBody).slice(0, 16)}`, object: "chat.completion", model: this.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
    return { response_body, signature: signEip191(teeText(this.kind, this.model, requestBody, response_body), this.sk), signing_address: this.address };
  }
}

/** Real NEAR AI Cloud model; the signature is produced inside the model TEE. */
export class NearAiTee implements Tee {
  kind: SignatureKind = "ProviderTee";
  mode = "near-ai-cloud" as const;
  model: string;
  private apiKey: string;
  constructor(model: string, apiKey: string) {
    this.model = model;
    this.apiKey = apiKey;
  }
  async complete(requestBody: string) {
    const r = await fetch(`${NEAR_AI_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: requestBody,
      signal: AbortSignal.timeout(90_000),
    });
    const response_body = await r.text();
    if (!r.ok) throw new Error(`NEAR AI Cloud HTTP ${r.status}: ${response_body.slice(0, 200)}`);
    const id = JSON.parse(response_body).id;
    // Signatures are cached on the serving node; retry as the docs advise.
    for (let i = 0; i < 8; i++) {
      const s = await fetch(`${NEAR_AI_BASE}/signature/${id}?model=${encodeURIComponent(this.model)}&signing_algo=ecdsa`, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      if (s.ok) {
        const j = await s.json();
        if (j.signature_kind === "gateway") this.kind = "Gateway";
        return { response_body, signature: j.signature, signing_address: String(j.signing_address).replace(/^0x/, "").toLowerCase() };
      }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    throw new Error(`no TEE signature for chat ${id}`);
  }
}

/** Attestation for judge registration (A-5, X-4). Requires an API key. */
export async function fetchAttestation(model: string, apiKey: string) {
  const nonce = randomBytes(32).toString("hex");
  const r = await fetch(`${NEAR_AI_BASE}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa&nonce=${nonce}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const raw = await r.text();
  if (!r.ok) throw new Error(`attestation HTTP ${r.status}: ${raw.slice(0, 200)}`);
  const j = JSON.parse(raw);
  const signing_address = String(j.signing_address ?? j.model_attestations?.[0]?.signing_address ?? "").replace(/^0x/, "").toLowerCase();
  return { raw, nonce, sha256: sha256hex(raw), signing_address };
}
