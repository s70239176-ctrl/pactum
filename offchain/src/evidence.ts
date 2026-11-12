// Evidence intake, run by every judge independently inside its TEE.
//  1. SSRF-guarded fetch of the evidence document (https only, no private hosts).
//  2. SHA-256 of the RAW bytes must equal the on-chain commitment.
//  3. The document must name the accused party and the treaty on trial.
//  4. Each judge re-reads the two independent telemetry feeds itself; if they
//     disagree by > 5% or are unreachable the result is FEED_CONFLICT.
import { sha256hex } from "./tee.ts";

export interface EvidenceDoc {
  pactum_evidence: 1;
  contract: string;
  treaty_id: number;
  accused: string;
  metric: string;
  baseline_bps: number;
  feeds: string[];
  narrative: string;
}

export type Intake =
  | { ok: true; doc: EvidenceDoc; observedBps: number; shortfallBps: number; feedValues: number[] }
  | { ok: false; reason: "NO_EVIDENCE" | "FEED_CONFLICT"; detail: string };

export type Fetcher = (url: string) => Promise<Uint8Array>;

const PRIVATE = [/^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^\[?::1\]?$/, /^\[?f[cd]/i];

export function safeUrl(u: string, allowLocal = false): URL {
  const url = new URL(u);
  const host = url.hostname.replace(/\.$/, "");
  if (!allowLocal) {
    if (url.protocol !== "https:") throw new Error("https only");
    if (PRIVATE.some((r) => r.test(host))) throw new Error("private host blocked");
  }
  if (u.includes("\\") || url.username || url.password) throw new Error("suspicious url");
  return url;
}

export const httpFetcher = (allowLocal = false): Fetcher => async (u) => {
  const res = await fetch(safeUrl(u, allowLocal), { redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > 256 * 1024) throw new Error("evidence too large");
  return buf;
};

export async function intake(
  dispute: { treaty_id: number; defendant: string; evidence_uri: string; evidence_hash: string },
  contract: string,
  fetcher: Fetcher,
): Promise<Intake> {
  let raw: Uint8Array;
  try {
    raw = await fetcher(dispute.evidence_uri);
  } catch (e) {
    return { ok: false, reason: "NO_EVIDENCE", detail: `unreadable: ${(e as Error).message}` };
  }
  if (sha256hex(raw) !== dispute.evidence_hash) {
    return { ok: false, reason: "NO_EVIDENCE", detail: "hash does not match on-chain commitment" };
  }
  let doc: EvidenceDoc;
  try {
    doc = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { ok: false, reason: "NO_EVIDENCE", detail: "not JSON" };
  }
  if (doc.pactum_evidence !== 1 || doc.accused !== dispute.defendant || doc.treaty_id !== dispute.treaty_id || doc.contract !== contract) {
    return { ok: false, reason: "NO_EVIDENCE", detail: "document does not identify this defendant/treaty/contract" };
  }
  if (!Array.isArray(doc.feeds) || doc.feeds.length < 2) {
    return { ok: false, reason: "FEED_CONFLICT", detail: "need two independent feeds" };
  }
  const hosts = new Set(doc.feeds.map((f) => new URL(f).host));
  if (hosts.size < 2) return { ok: false, reason: "FEED_CONFLICT", detail: "feeds share a host" };

  const values: number[] = [];
  for (const f of doc.feeds.slice(0, 2)) {
    try {
      const v = JSON.parse(new TextDecoder().decode(await fetcher(f)));
      const val = v?.[dispute.defendant]?.value_bps;
      if (!Number.isInteger(val) || val < 0 || val > 10_000) throw new Error("bad value");
      values.push(val);
    } catch (e) {
      return { ok: false, reason: "FEED_CONFLICT", detail: `feed ${f}: ${(e as Error).message}` };
    }
  }
  const [a, b] = values;
  if (Math.abs(a - b) > Math.max(a, b) * 0.05) {
    return { ok: false, reason: "FEED_CONFLICT", detail: `feeds diverge: ${a} vs ${b}` };
  }
  const observed = Math.round((a + b) / 2);
  const shortfall = Math.max(0, Math.min(10_000, Math.round(((doc.baseline_bps - observed) * 10_000) / Math.max(1, doc.baseline_bps))));
  return { ok: true, doc, observedBps: observed, shortfallBps: shortfall, feedValues: values };
}
