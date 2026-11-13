// In-memory mirror of contract/src/lib.rs for `sim` mode (D-9). Same rules, same
// refusal strings. The Rust contract is authoritative; its unit tests cover the
// same cases (see RULES.md ids in contract/src/tests.rs).
import { binding, teeText, recoverEip191, sha256hex, type TeeVote, type SignatureKind } from "./tee.ts";

export const Y = (near: number) => BigInt(Math.round(near * 1000)) * 10n ** 21n;
export const fmt = (y: bigint) => (Number(y / 10n ** 21n) / 1000).toString();
const BPS = 10_000n;
export class Refusal extends Error {}
const req = (c: boolean, m: string) => { if (!c) throw new Refusal(m); };

export const AGENT_METHODS = ["propose_treaty", "ratify", "cancel_proposal", "file_dispute", "request_exit", "set_policy", "withdraw_free_collateral"];

export interface Enclave { account: string; name: string; beneficiary: string; payout: { chain: string; address: string }; free: bigint; locked: bigint; max_bond?: bigint; guardian?: string; frozen: boolean; rep: { ratified: number; honored: number; breaches: number; elevated: number; malicious: number; disputes_won: number } }
export interface Treaty { id: number; party_a: string; party_b: string; terms: string; terms_hash: string; bond_a: bigint; bond_b: bigint; status: string; resume?: string; elevated_a: boolean; elevated_b: boolean; open_dispute?: number; params: Record<string, number>; telemetry_urls: string[] }
export interface Dispute { id: number; treaty_id: number; plaintiff: string; defendant: string; allegation: string; evidence_uri: string; evidence_sha256: string; bond: bigint; status: string; raw?: string; verdict?: string; metric_bps?: number; rationale?: string; judges: number[]; vote_hashes: string[] }
export interface Judge { id: number; model: string; signing_address: string; kind: SignatureKind; attestation_sha256: string; active: boolean }

export const score = (r: Enclave["rep"]) => Math.min(1000, Math.max(0, 500 + 40 * r.honored + 20 * r.disputes_won + 10 * r.ratified - 200 * r.breaches - 80 * r.elevated - 150 * r.malicious));

function clamp(v: string, m: number) {
  if ((v === "CRITICAL_BREACH" || v === "ELEVATED_RISK") && m < 500) return "NORMAL";
  if (v === "CRITICAL_BREACH" && m < 2500) return "ELEVATED_RISK";
  if (v === "MALICIOUS_REPORT" && m >= 2500) return "ELEVATED_RISK";
  return v;
}

export class Ledger {
  enclaves = new Map<string, Enclave>();
  treaties: Treaty[] = [];
  disputes: Dispute[] = [];
  judges: Judge[] = [];
  payouts: Array<{ id: number; dispute_id: number; to: string; chain: string; address: string; amount: bigint; status: string; path: string }> = [];
  dispute_escrow = 0n;
  payout_escrow = 0n;
  contract: string;
  quorum: number;
  constructor(contract: string, quorum: number) {
    this.contract = contract;
    this.quorum = quorum;
  }

  register_judge(model: string, signing_address: string, attestation_sha256: string, kind: SignatureKind = "ProviderTee") {
    this.judges.push({ id: this.judges.length, model, signing_address: signing_address.replace(/^0x/, "").toLowerCase(), kind, attestation_sha256, active: true });
    return this.judges.length - 1;
  }
  register_enclave(name: string, beneficiary: string, payout: Enclave["payout"], collateral: bigint) {
    const account = `${name}.${this.contract}`;
    req(!this.enclaves.has(account), "enclave name taken");
    this.enclaves.set(account, { account, name, beneficiary, payout, free: collateral, locked: 0n, frozen: false, rep: { ratified: 0, honored: 0, breaches: 0, elevated: 0, malicious: 0, disputes_won: 0 } });
    return account;
  }
  private e(a: string) { const e = this.enclaves.get(a); req(!!e, "caller is not an enclave"); return e!; }
  private lock(a: string, bond: bigint) {
    const e = this.e(a);
    req(!e.frozen, "enclave is frozen by its guardian");
    if (e.max_bond !== undefined) req(bond <= e.max_bond, "bond exceeds enclave's self-imposed cap");
    req(bond <= e.free, "insufficient free collateral");
    e.free -= bond; e.locked += bond;
  }
  private unlock(a: string, amt: bigint) { const e = this.e(a); e.locked -= amt; e.free += amt; }

  withdraw_free_collateral(caller: string, amount: bigint) {
    const e = this.e(caller);
    req(!e.frozen, "enclave is frozen by its guardian");
    req(amount <= e.free, "insufficient free collateral");
    e.free -= amount;
    return e.beneficiary;
  }
  set_policy(caller: string, max_bond?: bigint, guardian?: string) { const e = this.e(caller); req(!e.frozen, "enclave is frozen by its guardian"); e.max_bond = max_bond; e.guardian = guardian; }
  set_frozen(caller: string, enclave: string, frozen: boolean) { const e = this.e(enclave); req(e.guardian === caller, "guardian only"); e.frozen = frozen; }

  propose_treaty(caller: string, counterparty: string, terms: string, bond: bigint, counter_bond: bigint, params: Record<string, number> = {}, telemetry_urls: string[] = []) {
    req(caller !== counterparty, "cannot treaty with yourself");
    req(this.enclaves.has(counterparty), "counterparty is not an active enclave");
    req(terms.length > 0 && terms.length <= 4000, "terms length invalid");
    this.lock(caller, bond);
    const t: Treaty = { id: this.treaties.length, party_a: caller, party_b: counterparty, terms, terms_hash: sha256hex(terms), bond_a: bond, bond_b: counter_bond, status: "Proposed", elevated_a: false, elevated_b: false, params, telemetry_urls };
    this.treaties.push(t);
    return t;
  }
  ratify(caller: string, id: number, terms_hash: string) {
    const t = this.treaties[id];
    req(t?.status === "Proposed", "not proposed");
    req(t.party_b === caller, "not the counterparty");
    req(t.terms_hash === terms_hash, "terms changed; refusing to ratify");
    this.lock(caller, t.bond_b);
    t.status = "Active";
    this.e(t.party_a).rep.ratified++; this.e(caller).rep.ratified++;
  }
  /** T-4: proposer cancels an unratified proposal; its bond returns to free. */
  cancel_proposal(caller: string, id: number) {
    const t = this.treaties[id];
    req(t?.status === "Proposed", "not proposed");
    req(t.party_a === caller, "proposer only");
    t.status = "Cancelled";
    this.unlock(t.party_a, t.bond_a);
  }
  file_dispute(caller: string, treaty_id: number, allegation: string, evidence_uri: string, evidence_sha256: string, bond: bigint) {
    const t = this.treaties[treaty_id];
    req(caller === t.party_a || caller === t.party_b, "party only");
    req(t.status === "Active" || t.status === "Exiting", "treaty not in force");
    const e = this.e(caller);
    req(bond <= e.free, "insufficient free collateral");
    e.free -= bond; this.dispute_escrow += bond;
    const d: Dispute = { id: this.disputes.length, treaty_id, plaintiff: caller, defendant: caller === t.party_a ? t.party_b : t.party_a, allegation, evidence_uri, evidence_sha256, bond, status: "Open", judges: [], vote_hashes: [] };
    t.resume = t.status; t.status = "Disputed"; t.open_dispute = d.id;
    this.disputes.push(d);
    return d;
  }
  submit_verdicts(dispute_id: number, votes: TeeVote[]) {
    const d = this.disputes[dispute_id];
    req(d.status === "Open", "dispute not open");
    const bind = binding(this.contract, d.id, d.evidence_sha256);
    const seen = new Set<number>();
    const valid: Array<{ id: number; v: string; m: number; r: string; h: string }> = [];
    for (const v of votes) {
      const j = this.judges[v.judge_id];
      if (!j?.active || seen.has(v.judge_id) || !v.request_body.includes(bind)) continue;
      if (recoverEip191(teeText(j.kind, j.model, v.request_body, v.response_body), v.signature) !== j.signing_address) continue;
      try {
        const c = JSON.parse(v.response_body).choices[0].message.content as string;
        const p = JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
        if (!Number.isInteger(p.metric_bps) || p.metric_bps > 10_000) continue;
        seen.add(v.judge_id);
        valid.push({ id: v.judge_id, v: String(p.verdict).toUpperCase(), m: p.metric_bps, r: String(p.rationale ?? "").slice(0, 400), h: sha256hex(v.response_body) });
      } catch { /* malformed vote dropped */ }
    }
    const raw = valid.map((x) => x.v).find((c) => valid.filter((o) => o.v === c).length >= this.quorum);
    req(!!raw, "no quorum among valid judge signatures");
    const agree = valid.filter((o) => o.v === raw);
    const ms = agree.map((o) => o.m).sort((a, b) => a - b);
    const metric = ms[Math.floor(ms.length / 2)];
    const fin = clamp(raw!, metric);
    Object.assign(d, { status: "Resolved", raw, verdict: fin, metric_bps: metric, rationale: agree[0].r, judges: agree.map((o) => o.id), vote_hashes: agree.map((o) => o.h) });
    this.dispute_escrow -= d.bond;
    return { raw: raw!, final: fin, metric, judges: d.judges, payouts: this.settle(d, fin) };
  }
  private resume(t: Treaty) { t.open_dispute = undefined; if (t.status === "Disputed") t.status = t.resume ?? "Active"; }
  private slash(t: Treaty, def: string, bps: bigint) {
    const isA = t.party_a === def;
    const amt = ((isA ? t.bond_a : t.bond_b) * bps) / BPS;
    if (isA) t.bond_a -= amt; else t.bond_b -= amt;
    this.e(def).locked -= amt;
    return amt;
  }
  private close(t: Treaty) { t.status = "Closed"; this.unlock(t.party_a, t.bond_a); this.unlock(t.party_b, t.bond_b); t.bond_a = 0n; t.bond_b = 0n; }
  private pay(d: Dispute, amt: bigint) {
    if (!amt) return [];
    const tgt = this.e(d.plaintiff).payout;
    const id = this.payouts.length;
    const native = tgt.chain === "near";
    if (!native) this.payout_escrow += amt;
    const p = { id, dispute_id: d.id, to: d.plaintiff, chain: tgt.chain, address: tgt.address, amount: amt, status: native ? "Settled" : "Pending", path: `pactum/${d.plaintiff}/${id}` };
    this.payouts.push(p);
    return [p];
  }
  private settle(d: Dispute, v: string) {
    const t = this.treaties[d.treaty_id];
    this.resume(t);
    const P = this.e(d.plaintiff), D = this.e(d.defendant);
    switch (v) {
      case "CRITICAL_BREACH": { const amt = this.slash(t, d.defendant, BPS); P.free += d.bond; D.rep.breaches++; P.rep.disputes_won++; const p = this.pay(d, amt); this.close(t); return p; }
      case "ELEVATED_RISK": {
        const isA = t.party_a === d.defendant; const already = isA ? t.elevated_a : t.elevated_b;
        const amt = this.slash(t, d.defendant, 2500n); P.free += d.bond; D.rep.elevated++; P.rep.disputes_won++;
        if (isA) t.elevated_a = true; else t.elevated_b = true;
        const p = this.pay(d, amt); if (already) this.close(t); return p;
      }
      case "NORMAL": P.free += d.bond - (d.bond * 1000n) / BPS; return [];
      case "MALICIOUS_REPORT": D.free += d.bond; P.rep.malicious++; return [];
      default: P.free += d.bond; return [];
    }
  }
  liabilities() { let s = this.dispute_escrow + this.payout_escrow; for (const e of this.enclaves.values()) s += e.free + e.locked; return s; }
}
