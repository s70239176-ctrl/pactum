//! # Pactum v2: the on-chain diplomatic layer for autonomous AI agents
//!
//! Implements RULES.md. Rule ids (A-*, C-*, T-*, D-*, S-*, R-ROB-*) are cited inline.
//!
//! * Agents are **sovereign enclaves**: sub-accounts `<name>.<this contract>` created
//!   here, holding only a function-call key scoped to this contract (A-2, A-3).
//! * Collateral lives in an escrow ledger with `free` / `locked` balances (C-*).
//! * Treaties lock bonds from collateral; agents never attach deposits, so a
//!   function-call key (via meta transactions) is enough for every agent action.
//! * Disputes are judged by NEAR AI Cloud models. Every vote is the TEE's own
//!   signature (`{model}:{sha256(request)}:{sha256(response)}`, EIP-191,
//!   secp256k1) recovered on-chain with `ecrecover` and matched to the
//!   attested `signing_address` (D-5).
//! * Non-NEAR payouts are signed through Chain Signatures (S-6).

// near-sdk schedules a `Promise` when it is dropped; fire-and-forget transfers are intended.
#![allow(unused_must_use)]

use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, Vector};
use near_sdk::{
    env, near, require, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PublicKey,
};
use std::collections::BTreeMap;

pub const BPS: u128 = 10_000;
pub const ELEVATED_SLASH_BPS: u128 = 2_500; // S-2
pub const NORMAL_FEE_BPS: u128 = 1_000; // S-3
pub const METRIC_FLOOR_BPS: u32 = 500; // D-7
pub const METRIC_CRITICAL_BPS: u32 = 2_500; // D-7
pub const MIN_DISPUTE_BOND: NearToken = NearToken::from_millinear(100); // D-1
pub const ENCLAVE_FUNDING: NearToken = NearToken::from_millinear(100); // storage for the sub-account
pub const AGENT_KEY_ALLOWANCE: NearToken = NearToken::from_millinear(250); // A-3
pub const AGENT_METHODS: &str =
    "propose_treaty,ratify,cancel_proposal,file_dispute,request_exit,set_policy,withdraw_free_collateral";
pub const PROPOSAL_TTL_NS: u64 = 24 * 3_600 * 1_000_000_000; // T-4
pub const DISPUTE_TIMEOUT_NS: u64 = 72 * 3_600 * 1_000_000_000; // D-8
pub const MAX_TERMS: usize = 4_000;
pub const MAX_BODY: usize = 12_000;
pub const MPC_GAS: Gas = Gas::from_tgas(250);

// ------------------------------------------------------------------ types

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct PayoutTarget {
    /// "near", "ethereum", "base", "arbitrum", "bitcoin", "solana"
    pub chain: String,
    pub address: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct Reputation {
    pub ratified: u32,
    pub honored: u32,
    pub breaches: u32,
    pub elevated: u32,
    pub malicious: u32,
    pub disputes_won: u32,
}

impl Reputation {
    /// S-7
    pub fn score(&self) -> u32 {
        let good = 500 + 40 * self.honored + 20 * self.disputes_won + 10 * self.ratified;
        let bad = 200 * self.breaches + 80 * self.elevated + 150 * self.malicious;
        good.saturating_sub(bad).min(1_000)
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Enclave {
    pub account: AccountId,
    pub name: String,
    /// Where `withdraw_free_collateral` sends funds. Immutable (C-2).
    pub beneficiary: AccountId,
    pub payout: PayoutTarget,
    pub free: NearToken,
    pub locked: NearToken,
    pub max_bond: Option<NearToken>,
    pub guardian: Option<AccountId>,
    pub frozen: bool,
    pub rep: Reputation,
    pub created_ns: U64,
    pub active: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum TreatyStatus {
    Proposed,
    Active,
    Disputed,
    Exiting,
    Closed,
    Cancelled,
    Expired,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Treaty {
    pub id: u64,
    pub party_a: AccountId,
    pub party_b: AccountId,
    pub terms: String,
    pub terms_hash: String,
    pub bond_a: NearToken,
    pub bond_b: NearToken,
    pub duration_ns: U64,
    pub notice_ns: U64,
    pub params: BTreeMap<String, u64>,
    pub telemetry_urls: Vec<String>,
    pub status: TreatyStatus,
    /// status to return to after a dispute (Active or Exiting)
    pub resume_status: Option<TreatyStatus>,
    pub created_ns: U64,
    pub activated_ns: Option<U64>,
    pub exit_at_ns: Option<U64>,
    pub elevated_a: bool,
    pub elevated_b: bool,
    pub open_dispute: Option<u64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Verdict {
    CriticalBreach,
    ElevatedRisk,
    Normal,
    MaliciousReport,
    FeedConflict,
    NoEvidence,
}

impl Verdict {
    pub fn wire(&self) -> &'static str {
        match self {
            Verdict::CriticalBreach => "CRITICAL_BREACH",
            Verdict::ElevatedRisk => "ELEVATED_RISK",
            Verdict::Normal => "NORMAL",
            Verdict::MaliciousReport => "MALICIOUS_REPORT",
            Verdict::FeedConflict => "FEED_CONFLICT",
            Verdict::NoEvidence => "NO_EVIDENCE",
        }
    }
    pub fn parse(s: &str) -> Option<Verdict> {
        Some(match s.trim().to_ascii_uppercase().replace([' ', '-'], "_").as_str() {
            "CRITICAL_BREACH" | "CRITICALBREACH" => Verdict::CriticalBreach,
            "ELEVATED_RISK" | "ELEVATEDRISK" => Verdict::ElevatedRisk,
            "NORMAL" => Verdict::Normal,
            "MALICIOUS_REPORT" | "MALICIOUSREPORT" => Verdict::MaliciousReport,
            "FEED_CONFLICT" | "FEEDCONFLICT" => Verdict::FeedConflict,
            "NO_EVIDENCE" | "NOEVIDENCE" => Verdict::NoEvidence,
            _ => return None,
        })
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum DisputeStatus {
    Open,
    Resolved,
    Expired,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Dispute {
    pub id: u64,
    pub treaty_id: u64,
    pub plaintiff: AccountId,
    pub defendant: AccountId,
    pub allegation: String,
    pub evidence_uri: String,
    pub evidence_sha256: String,
    pub bond: NearToken,
    pub filed_ns: U64,
    pub status: DisputeStatus,
    pub raw_verdict: Option<Verdict>,
    pub verdict: Option<Verdict>,
    pub metric_bps: Option<u32>,
    pub rationale: Option<String>,
    pub judges: Vec<u32>,
    /// sha256 of each accepted TEE response body, for re-verification (X-3)
    pub vote_hashes: Vec<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum SignatureKind {
    /// text = "{model}:{sha256(req)}:{sha256(resp)}"
    ProviderTee,
    /// text = "{sha256(req)}:{sha256(resp)}"
    Gateway,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Judge {
    pub id: u32,
    pub model: String,
    /// 20-byte Ethereum-style address (lowercase hex, no 0x) from the attestation report.
    pub signing_address: String,
    pub kind: SignatureKind,
    /// sha256 of the raw attestation report (X-4).
    pub attestation_sha256: String,
    pub active: bool,
}

/// One judge vote as relayed to the chain: exact bytes sent to and received
/// from the TEE, plus the TEE's signature over their hashes.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TeeVote {
    pub judge_id: u32,
    pub request_body: String,
    pub response_body: String,
    /// 65-byte r||s||v hex, optional 0x prefix (as returned by /v1/signature).
    pub signature: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum PayoutStatus {
    Pending,
    Signing,
    Signed,
    Settled,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Payout {
    pub id: u64,
    pub dispute_id: u64,
    pub beneficiary_enclave: AccountId,
    pub target: PayoutTarget,
    pub amount: NearToken,
    pub status: PayoutStatus,
    pub path: String,
    pub mpc_signature: Option<String>,
    pub dest_tx: Option<String>,
}

// ---------------------------------------------------------------- helpers

fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"pactum","version":"2.0.0","event":event,"data":[data]})
    ));
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn sha256hex(b: &[u8]) -> String {
    hex(&env::sha256(b))
}

fn share(a: NearToken, bps: u128) -> NearToken {
    NearToken::from_yoctonear(a.as_yoctonear() * bps / BPS)
}

fn valid_name(n: &str) -> bool {
    (2..=32).contains(&n.len())
        && n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
        && !n.starts_with(['-', '_'])
        && !n.ends_with(['-', '_'])
}

/// The string a judge's request must contain, binding the TEE call to this dispute (D-5).
pub fn binding(contract: &str, dispute_id: u64, evidence_sha256: &str) -> String {
    format!("pactum:v1|{contract}|{dispute_id}|{evidence_sha256}")
}

/// Text NEAR AI Cloud signs (docs.near.ai/cloud/verification/chat).
pub fn tee_text(kind: &SignatureKind, model: &str, req: &str, resp: &str) -> String {
    let (rq, rs) = (sha256hex(req.as_bytes()), sha256hex(resp.as_bytes()));
    match kind {
        SignatureKind::ProviderTee => format!("{model}:{rq}:{rs}"),
        SignatureKind::Gateway => format!("{rq}:{rs}"),
    }
}

/// EIP-191 personal_sign recovery -> lowercase hex address.
pub fn recover_eip191(text: &str, sig_hex: &str) -> Option<String> {
    let sig = unhex(sig_hex)?;
    if sig.len() != 65 {
        return None;
    }
    let mut v = sig[64];
    if v >= 27 {
        v -= 27;
    }
    if v > 1 {
        return None;
    }
    let mut msg = format!("\x19Ethereum Signed Message:\n{}", text.len()).into_bytes();
    msg.extend_from_slice(text.as_bytes());
    let hash = env::keccak256(&msg);
    let pk = env::ecrecover(&hash, &sig[..64], v, true)?;
    Some(hex(&env::keccak256(&pk)[12..]))
}

/// Extracts {verdict, metric_bps, rationale} from an OpenAI-style response body.
pub fn parse_vote(response_body: &str) -> Option<(Verdict, u32, String)> {
    let v: Value = serde_json::from_str(response_body).ok()?;
    let content = v["choices"][0]["message"]["content"].as_str()?;
    let (s, e) = (content.find('{')?, content.rfind('}')?);
    let inner: Value = serde_json::from_str(&content[s..=e]).ok()?;
    let verdict = Verdict::parse(inner["verdict"].as_str()?)?;
    let metric = inner["metric_bps"].as_u64().filter(|m| *m <= 10_000)? as u32;
    let rationale: String = inner["rationale"].as_str().unwrap_or("").chars().take(400).collect();
    Some((verdict, metric, rationale))
}

/// D-7
pub fn clamp(raw: Verdict, m: u32) -> Verdict {
    match raw {
        Verdict::CriticalBreach | Verdict::ElevatedRisk if m < METRIC_FLOOR_BPS => Verdict::Normal,
        Verdict::CriticalBreach if m < METRIC_CRITICAL_BPS => Verdict::ElevatedRisk,
        Verdict::MaliciousReport if m >= METRIC_CRITICAL_BPS => Verdict::ElevatedRisk,
        v => v,
    }
}

fn mpc_domain(chain: &str) -> u64 {
    match chain {
        "solana" => 1,
        _ => 0, // bitcoin + EVM chains use secp256k1
    }
}

// ---------------------------------------------------------------- contract

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Pactum {
    owner: AccountId,
    treasury: AccountId,
    quorum: u32,
    mpc_signer: AccountId,
    enclaves: IterableMap<AccountId, Enclave>,
    treaties: Vector<Treaty>,
    disputes: Vector<Dispute>,
    judges: Vector<Judge>,
    payouts: Vector<Payout>,
    /// Σ open dispute bonds, for the C-5 invariant.
    dispute_escrow: NearToken,
    /// Σ funds owed to non-NEAR payouts not yet settled.
    payout_escrow: NearToken,
}

#[near]
impl Pactum {
    #[init]
    pub fn new(owner: AccountId, treasury: AccountId, quorum: u32, mpc_signer: AccountId) -> Self {
        require!(quorum >= 1, "quorum must be >= 1");
        Self {
            owner,
            treasury,
            quorum,
            mpc_signer,
            enclaves: IterableMap::new(b"e"),
            treaties: Vector::new(b"t"),
            disputes: Vector::new(b"d"),
            judges: Vector::new(b"j"),
            payouts: Vector::new(b"p"),
            dispute_escrow: NearToken::from_yoctonear(0),
            payout_escrow: NearToken::from_yoctonear(0),
        }
    }

    // ------------------------------------------------------------ admin (A-1, A-5)

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    pub fn register_judge(
        &mut self,
        model: String,
        signing_address: String,
        kind: SignatureKind,
        attestation_sha256: String,
    ) -> u32 {
        self.assert_owner();
        let addr = signing_address.trim_start_matches("0x").to_ascii_lowercase();
        require!(addr.len() == 40 && unhex(&addr).is_some(), "signing_address must be 20-byte hex");
        require!(is_hex64(&attestation_sha256), "attestation_sha256 must be hex sha256");
        let id = self.judges.len();
        self.judges.push(Judge { id, model: model.clone(), signing_address: addr.clone(), kind, attestation_sha256, active: true });
        emit("judge_registered", json!({"judge_id": id, "model": model, "signing_address": addr}));
        id
    }

    pub fn set_judge_active(&mut self, judge_id: u32, active: bool) {
        self.assert_owner();
        self.judges.get_mut(judge_id).expect("no judge").active = active;
    }

    pub fn set_quorum(&mut self, quorum: u32) {
        self.assert_owner();
        require!(quorum >= 1, "quorum must be >= 1");
        self.quorum = quorum;
    }

    // ------------------------------------------------------------ enclaves (A-2, A-3, C-*)

    /// Creates `<name>.<contract>` with ONLY a function-call key for this
    /// contract, and credits the remaining deposit as free collateral.
    #[payable]
    pub fn register_enclave(
        &mut self,
        name: String,
        agent_public_key: PublicKey,
        beneficiary: AccountId,
        payout: PayoutTarget,
        max_bond: Option<NearToken>,
        guardian: Option<AccountId>,
    ) -> Promise {
        require!(valid_name(&name), "invalid enclave name");
        let account: AccountId = format!("{}.{}", name, env::current_account_id()).parse().unwrap();
        require!(!self.enclaves.contains_key(&account), "enclave name taken");
        let deposit = env::attached_deposit();
        require!(deposit > ENCLAVE_FUNDING, "deposit must exceed 0.1 NEAR (account funding)");
        let collateral = deposit.saturating_sub(ENCLAVE_FUNDING);
        self.enclaves.insert(
            account.clone(),
            Enclave {
                account: account.clone(),
                name: name.clone(),
                beneficiary,
                payout,
                free: collateral,
                locked: NearToken::from_yoctonear(0),
                max_bond,
                guardian,
                frozen: false,
                rep: Reputation::default(),
                created_ns: env::block_timestamp().into(),
                active: false,
            },
        );
        Promise::new(account.clone())
            .create_account()
            .transfer(ENCLAVE_FUNDING)
            .add_access_key_allowance(
                agent_public_key,
                Allowance::limited(AGENT_KEY_ALLOWANCE).unwrap(),
                env::current_account_id(),
                AGENT_METHODS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_enclave_created(account, env::predecessor_account_id(), deposit))
    }

    #[private]
    pub fn on_enclave_created(
        &mut self,
        account: AccountId,
        payer: AccountId,
        deposit: NearToken,
        #[callback_result] r: Result<(), PromiseError>,
    ) -> bool {
        if r.is_ok() {
            if let Some(e) = self.enclaves.get_mut(&account) {
                e.active = true;
            }
            emit("enclave_registered", json!({"enclave": account}));
            true
        } else {
            // Account creation failed: undo and refund (never panic in callbacks).
            self.enclaves.remove(&account);
            Promise::new(payer).transfer(deposit);
            emit("enclave_failed", json!({"enclave": account}));
            false
        }
    }

    /// Anyone may top up an enclave's collateral (e.g. after an Intents swap settles).
    #[payable]
    pub fn deposit_collateral(&mut self, enclave: AccountId) {
        let amt = env::attached_deposit();
        require!(!amt.is_zero(), "attach NEAR");
        let e = self.enclaves.get_mut(&enclave).expect("unknown enclave");
        e.free = e.free.saturating_add(amt);
        emit("collateral_deposited", json!({"enclave": enclave, "amount": amt}));
    }

    /// C-2: only the enclave, only free funds, only to its immutable beneficiary.
    pub fn withdraw_free_collateral(&mut self, amount: NearToken) -> Promise {
        let me = env::predecessor_account_id();
        let e = self.enclaves.get_mut(&me).expect("caller is not an enclave");
        require!(!e.frozen, "enclave is frozen by its guardian");
        require!(amount <= e.free, "insufficient free collateral");
        e.free = e.free.saturating_sub(amount); // C-6: deduct first
        let to = e.beneficiary.clone();
        emit("collateral_withdrawn", json!({"enclave": me, "amount": amount, "to": to}));
        Promise::new(to).transfer(amount)
    }

    pub fn set_policy(&mut self, max_bond: Option<NearToken>, guardian: Option<AccountId>) {
        let me = env::predecessor_account_id();
        let e = self.enclaves.get_mut(&me).expect("caller is not an enclave");
        require!(!e.frozen, "enclave is frozen by its guardian");
        e.max_bond = max_bond;
        e.guardian = guardian;
    }

    pub fn set_frozen(&mut self, enclave: AccountId, frozen: bool) {
        let e = self.enclaves.get_mut(&enclave).expect("unknown enclave");
        require!(e.guardian.as_ref() == Some(&env::predecessor_account_id()), "guardian only");
        e.frozen = frozen;
        emit("enclave_frozen", json!({"enclave": enclave, "frozen": frozen}));
    }

    fn lock(&mut self, who: &AccountId, bond: NearToken) {
        let e = self.enclaves.get_mut(who).expect("caller is not an enclave");
        require!(e.active, "enclave not active");
        require!(!e.frozen, "enclave is frozen by its guardian");
        if let Some(max) = e.max_bond {
            require!(bond <= max, "bond exceeds enclave's self-imposed cap");
        }
        require!(bond <= e.free, "insufficient free collateral");
        e.free = e.free.saturating_sub(bond);
        e.locked = e.locked.saturating_add(bond);
    }

    fn unlock(&mut self, who: &AccountId, amt: NearToken) {
        if amt.is_zero() {
            return;
        }
        let e = self.enclaves.get_mut(who).unwrap();
        e.locked = e.locked.saturating_sub(amt);
        e.free = e.free.saturating_add(amt);
    }

    fn rep(&mut self, who: &AccountId) -> &mut Reputation {
        &mut self.enclaves.get_mut(who).unwrap().rep
    }

    // ------------------------------------------------------------ treaties (T-*)

    #[allow(clippy::too_many_arguments)]
    pub fn propose_treaty(
        &mut self,
        counterparty: AccountId,
        terms: String,
        bond: NearToken,
        counter_bond: NearToken,
        duration_ns: U64,
        notice_ns: U64,
        params: Option<BTreeMap<String, u64>>,
        telemetry_urls: Option<Vec<String>>,
    ) -> u64 {
        let me = env::predecessor_account_id();
        require!(me != counterparty, "cannot treaty with yourself");
        require!(self.enclaves.get(&counterparty).map(|e| e.active).unwrap_or(false), "counterparty is not an active enclave");
        require!(!bond.is_zero() && !counter_bond.is_zero(), "both bonds must be > 0");
        require!(!terms.is_empty() && terms.len() <= MAX_TERMS, "terms length invalid");
        require!(duration_ns.0 > 0, "duration must be > 0");
        let params = params.unwrap_or_default();
        require!(params.len() <= 16, "at most 16 params");
        let telemetry_urls = telemetry_urls.unwrap_or_default();
        require!(telemetry_urls.len() <= 2, "at most 2 telemetry urls");
        require!(telemetry_urls.iter().all(|u| u.starts_with("https://") && u.len() <= 512), "telemetry urls must be https");
        self.lock(&me, bond);
        let id = self.treaties.len() as u64;
        let terms_hash = sha256hex(terms.as_bytes());
        self.treaties.push(Treaty {
            id,
            party_a: me.clone(),
            party_b: counterparty.clone(),
            terms,
            terms_hash: terms_hash.clone(),
            bond_a: bond,
            bond_b: counter_bond,
            duration_ns,
            notice_ns,
            params,
            telemetry_urls,
            status: TreatyStatus::Proposed,
            resume_status: None,
            created_ns: env::block_timestamp().into(),
            activated_ns: None,
            exit_at_ns: None,
            elevated_a: false,
            elevated_b: false,
            open_dispute: None,
        });
        emit("treaty_proposed", json!({"treaty_id": id, "a": me, "b": counterparty, "terms_hash": terms_hash, "bond": bond, "counter_bond": counter_bond}));
        id
    }

    pub fn ratify(&mut self, treaty_id: u64, terms_hash: String) {
        let me = env::predecessor_account_id();
        let (bond_b, a) = {
            let t = self.treaties.get(treaty_id as u32).expect("no treaty");
            require!(t.status == TreatyStatus::Proposed, "not proposed");
            require!(t.party_b == me, "not the counterparty");
            require!(env::block_timestamp() < t.created_ns.0 + PROPOSAL_TTL_NS, "proposal expired");
            require!(t.terms_hash == terms_hash, "terms changed; refusing to ratify"); // R-ROB-7
            (t.bond_b, t.party_a.clone())
        };
        self.lock(&me, bond_b);
        let t = self.treaties.get_mut(treaty_id as u32).unwrap();
        t.status = TreatyStatus::Active;
        t.activated_ns = Some(env::block_timestamp().into());
        self.rep(&a).ratified += 1;
        self.rep(&me).ratified += 1;
        emit("treaty_ratified", json!({"treaty_id": treaty_id}));
    }

    pub fn cancel_proposal(&mut self, treaty_id: u64) {
        let t = self.treaties.get_mut(treaty_id as u32).expect("no treaty");
        require!(t.status == TreatyStatus::Proposed, "not proposed");
        require!(t.party_a == env::predecessor_account_id(), "proposer only");
        t.status = TreatyStatus::Cancelled;
        let (a, bond) = (t.party_a.clone(), t.bond_a);
        self.unlock(&a, bond);
        emit("treaty_cancelled", json!({"treaty_id": treaty_id}));
    }

    pub fn expire_proposal(&mut self, treaty_id: u64) {
        let t = self.treaties.get_mut(treaty_id as u32).expect("no treaty");
        require!(t.status == TreatyStatus::Proposed, "not proposed");
        require!(env::block_timestamp() >= t.created_ns.0 + PROPOSAL_TTL_NS, "proposal not expired");
        t.status = TreatyStatus::Expired;
        let (a, bond) = (t.party_a.clone(), t.bond_a);
        self.unlock(&a, bond);
    }

    /// T-5: after the treaty's duration with no open dispute, anyone concludes it.
    pub fn conclude(&mut self, treaty_id: u64) {
        let t = self.treaties.get(treaty_id as u32).expect("no treaty").clone();
        require!(t.status == TreatyStatus::Active || t.status == TreatyStatus::Exiting, "not in force");
        require!(t.open_dispute.is_none(), "dispute open");
        require!(env::block_timestamp() >= t.activated_ns.unwrap().0 + t.duration_ns.0, "duration not over");
        self.close(treaty_id, "concluded", true);
    }

    pub fn request_exit(&mut self, treaty_id: u64) {
        let me = env::predecessor_account_id();
        let now = env::block_timestamp();
        let t = self.treaties.get_mut(treaty_id as u32).expect("no treaty");
        require!(t.status == TreatyStatus::Active, "not active");
        require!(me == t.party_a || me == t.party_b, "party only");
        t.status = TreatyStatus::Exiting;
        t.exit_at_ns = Some((now + t.notice_ns.0).into());
        emit("treaty_exiting", json!({"treaty_id": treaty_id, "by": me}));
    }

    pub fn execute_exit(&mut self, treaty_id: u64) {
        let t = self.treaties.get(treaty_id as u32).expect("no treaty");
        require!(t.status == TreatyStatus::Exiting, "not exiting");
        require!(env::block_timestamp() >= t.exit_at_ns.unwrap().0, "notice period not over");
        self.close(treaty_id, "exit", true);
    }

    /// Releases both remaining bonds; optionally credits `honored`.
    fn close(&mut self, treaty_id: u64, reason: &str, honored: bool) {
        let t = self.treaties.get_mut(treaty_id as u32).unwrap();
        t.status = TreatyStatus::Closed;
        let (a, b, ba, bb) = (t.party_a.clone(), t.party_b.clone(), t.bond_a, t.bond_b);
        t.bond_a = NearToken::from_yoctonear(0);
        t.bond_b = NearToken::from_yoctonear(0);
        self.unlock(&a, ba);
        self.unlock(&b, bb);
        if honored {
            self.rep(&a).honored += 1;
            self.rep(&b).honored += 1;
        }
        emit("treaty_closed", json!({"treaty_id": treaty_id, "reason": reason}));
    }

    // ------------------------------------------------------------ disputes (D-*)

    pub fn file_dispute(
        &mut self,
        treaty_id: u64,
        allegation: String,
        evidence_uri: String,
        evidence_sha256: String,
        dispute_bond: NearToken,
    ) -> u64 {
        let me = env::predecessor_account_id();
        require!(dispute_bond >= MIN_DISPUTE_BOND, "dispute bond too small");
        require!(is_hex64(&evidence_sha256), "evidence_sha256 must be lowercase hex sha256");
        require!(evidence_uri.starts_with("https://") && evidence_uri.len() <= 512, "evidence_uri must be https");
        require!(allegation.len() <= 2_000, "allegation too long");
        let t = self.treaties.get(treaty_id as u32).expect("no treaty").clone();
        require!(me == t.party_a || me == t.party_b, "party only"); // R-ROB-4
        require!(t.status == TreatyStatus::Active || t.status == TreatyStatus::Exiting, "treaty not in force");
        let defendant = if me == t.party_a { t.party_b.clone() } else { t.party_a.clone() };
        {
            let e = self.enclaves.get_mut(&me).unwrap();
            require!(!e.frozen, "enclave is frozen by its guardian");
            require!(dispute_bond <= e.free, "insufficient free collateral");
            e.free = e.free.saturating_sub(dispute_bond);
        }
        self.dispute_escrow = self.dispute_escrow.saturating_add(dispute_bond);
        let id = self.disputes.len() as u64;
        let tm = self.treaties.get_mut(treaty_id as u32).unwrap();
        tm.resume_status = Some(tm.status.clone());
        tm.status = TreatyStatus::Disputed;
        tm.open_dispute = Some(id);
        self.disputes.push(Dispute {
            id,
            treaty_id,
            plaintiff: me.clone(),
            defendant: defendant.clone(),
            allegation,
            evidence_uri,
            evidence_sha256: evidence_sha256.clone(),
            bond: dispute_bond,
            filed_ns: env::block_timestamp().into(),
            status: DisputeStatus::Open,
            raw_verdict: None,
            verdict: None,
            metric_bps: None,
            rationale: None,
            judges: vec![],
            vote_hashes: vec![],
        });
        emit("dispute_filed", json!({"dispute_id": id, "treaty_id": treaty_id, "plaintiff": me, "defendant": defendant, "evidence_sha256": evidence_sha256,
            "binding": binding(env::current_account_id().as_str(), id, &evidence_sha256)}));
        id
    }

    /// Anyone relays TEE votes; the contract trusts only the signatures (D-5, D-6).
    pub fn submit_verdicts(&mut self, dispute_id: u64, votes: Vec<TeeVote>) -> Verdict {
        let d = self.disputes.get(dispute_id as u32).expect("no dispute").clone();
        require!(d.status == DisputeStatus::Open, "dispute not open");
        let bind = binding(env::current_account_id().as_str(), dispute_id, &d.evidence_sha256);

        let mut seen: Vec<u32> = vec![];
        let mut valid: Vec<(u32, Verdict, u32, String, String)> = vec![];
        for v in &votes {
            if seen.contains(&v.judge_id) || v.request_body.len() > MAX_BODY || v.response_body.len() > MAX_BODY {
                continue;
            }
            let Some(j) = self.judges.get(v.judge_id) else { continue };
            if !j.active || !v.request_body.contains(&bind) {
                continue;
            }
            let text = tee_text(&j.kind, &j.model, &v.request_body, &v.response_body);
            if recover_eip191(&text, &v.signature).as_deref() != Some(j.signing_address.as_str()) {
                continue;
            }
            let Some((verdict, metric, rationale)) = parse_vote(&v.response_body) else { continue };
            seen.push(v.judge_id);
            valid.push((v.judge_id, verdict, metric, rationale, sha256hex(v.response_body.as_bytes())));
        }

        let raw = valid
            .iter()
            .map(|x| x.1)
            .find(|cand| valid.iter().filter(|o| o.1 == *cand).count() as u32 >= self.quorum)
            .unwrap_or_else(|| env::panic_str("no quorum among valid judge signatures")); // R-ROB-5/6
        let agree: Vec<_> = valid.iter().filter(|o| o.1 == raw).collect();
        let mut ms: Vec<u32> = agree.iter().map(|o| o.2).collect();
        ms.sort_unstable();
        let metric = ms[ms.len() / 2];
        let fin = clamp(raw, metric);
        {
            let dm = self.disputes.get_mut(dispute_id as u32).unwrap();
            dm.status = DisputeStatus::Resolved;
            dm.raw_verdict = Some(raw);
            dm.verdict = Some(fin);
            dm.metric_bps = Some(metric);
            dm.rationale = Some(agree[0].3.clone());
            dm.judges = agree.iter().map(|o| o.0).collect();
            dm.vote_hashes = agree.iter().map(|o| o.4.clone()).collect();
        }
        self.dispute_escrow = self.dispute_escrow.saturating_sub(d.bond);
        self.settle(&d, fin);
        emit("ruling", json!({"dispute_id": dispute_id, "raw": raw.wire(), "final": fin.wire(), "metric_bps": metric, "judges": agree.iter().map(|o| o.0).collect::<Vec<_>>()}));
        fin
    }

    pub fn expire_dispute(&mut self, dispute_id: u64) {
        let d = self.disputes.get(dispute_id as u32).expect("no dispute").clone();
        require!(d.status == DisputeStatus::Open, "dispute not open");
        require!(env::block_timestamp() >= d.filed_ns.0 + DISPUTE_TIMEOUT_NS, "not expired");
        self.disputes.get_mut(dispute_id as u32).unwrap().status = DisputeStatus::Expired;
        self.dispute_escrow = self.dispute_escrow.saturating_sub(d.bond);
        let p = self.enclaves.get_mut(&d.plaintiff).unwrap();
        p.free = p.free.saturating_add(d.bond);
        self.resume(d.treaty_id);
        emit("dispute_expired", json!({"dispute_id": dispute_id}));
    }

    fn resume(&mut self, tid: u64) {
        let t = self.treaties.get_mut(tid as u32).unwrap();
        t.open_dispute = None;
        if t.status == TreatyStatus::Disputed {
            t.status = t.resume_status.take().unwrap_or(TreatyStatus::Active);
        }
    }

    fn credit_free(&mut self, who: &AccountId, amt: NearToken) {
        let e = self.enclaves.get_mut(who).unwrap();
        e.free = e.free.saturating_add(amt);
    }

    /// Moves `bps` of the defendant's locked bond out of escrow.
    fn slash(&mut self, tid: u64, defendant: &AccountId, bps: u128) -> NearToken {
        let t = self.treaties.get_mut(tid as u32).unwrap();
        let is_a = t.party_a == *defendant;
        let bond = if is_a { &mut t.bond_a } else { &mut t.bond_b };
        let amt = share(*bond, bps);
        *bond = bond.saturating_sub(amt);
        let e = self.enclaves.get_mut(defendant).unwrap();
        e.locked = e.locked.saturating_sub(amt);
        amt
    }

    fn settle(&mut self, d: &Dispute, v: Verdict) {
        self.resume(d.treaty_id);
        match v {
            Verdict::CriticalBreach => {
                // S-1
                let amt = self.slash(d.treaty_id, &d.defendant, BPS);
                self.credit_free(&d.plaintiff, d.bond);
                self.pay(d.id, &d.plaintiff, amt);
                self.rep(&d.defendant).breaches += 1;
                self.rep(&d.plaintiff).disputes_won += 1;
                self.close(d.treaty_id, "critical_breach", false);
            }
            Verdict::ElevatedRisk => {
                // S-2
                let t = self.treaties.get(d.treaty_id as u32).unwrap();
                let is_a = t.party_a == d.defendant;
                let already = if is_a { t.elevated_a } else { t.elevated_b };
                let amt = self.slash(d.treaty_id, &d.defendant, ELEVATED_SLASH_BPS);
                self.credit_free(&d.plaintiff, d.bond);
                self.pay(d.id, &d.plaintiff, amt);
                self.rep(&d.defendant).elevated += 1;
                self.rep(&d.plaintiff).disputes_won += 1;
                let t = self.treaties.get_mut(d.treaty_id as u32).unwrap();
                if is_a { t.elevated_a = true } else { t.elevated_b = true }
                if already {
                    self.close(d.treaty_id, "repeat_elevated", false);
                }
            }
            Verdict::Normal => {
                // S-3
                let fee = share(d.bond, NORMAL_FEE_BPS);
                self.credit_free(&d.plaintiff, d.bond.saturating_sub(fee));
                Promise::new(self.treasury.clone()).transfer(fee);
            }
            Verdict::MaliciousReport => {
                // S-4
                self.credit_free(&d.defendant, d.bond);
                self.rep(&d.plaintiff).malicious += 1;
            }
            Verdict::FeedConflict | Verdict::NoEvidence => {
                // S-5
                self.credit_free(&d.plaintiff, d.bond);
            }
        }
    }

    /// S-6: NEAR targets are paid immediately; others are queued for Chain Signatures.
    fn pay(&mut self, dispute_id: u64, to_enclave: &AccountId, amount: NearToken) {
        if amount.is_zero() {
            return;
        }
        let target = self.enclaves.get(to_enclave).unwrap().payout.clone();
        let id = self.payouts.len() as u64;
        let native = target.chain == "near";
        let path = format!("pactum/{}/{}", to_enclave, id);
        if native {
            let acct: AccountId = target.address.parse().expect("invalid near payout account");
            Promise::new(acct).transfer(amount);
        } else {
            self.payout_escrow = self.payout_escrow.saturating_add(amount);
        }
        self.payouts.push(Payout {
            id,
            dispute_id,
            beneficiary_enclave: to_enclave.clone(),
            target: target.clone(),
            amount,
            status: if native { PayoutStatus::Settled } else { PayoutStatus::Pending },
            path: path.clone(),
            mpc_signature: None,
            dest_tx: None,
        });
        emit("payout", json!({"payout_id": id, "chain": target.chain, "address": target.address, "amount": amount, "native": native, "path": path}));
    }

    // ------------------------------------------------------------ Chain Signatures (S-6)

    #[payable]
    pub fn request_payout_signature(&mut self, payout_id: u64, payload_hex: String) -> Promise {
        self.assert_owner();
        require!(env::attached_deposit() >= NearToken::from_yoctonear(1), "attach at least 1 yoctoNEAR");
        let p = self.payouts.get_mut(payout_id as u32).expect("no payout");
        require!(p.status == PayoutStatus::Pending, "payout not pending");
        let domain = mpc_domain(&p.target.chain);
        if domain == 0 {
            require!(is_hex64(&payload_hex), "secp256k1 payload must be 32-byte hex");
        }
        p.status = PayoutStatus::Signing;
        let payload_v2 = if domain == 0 { json!({"Ecdsa": payload_hex}) } else { json!({"Eddsa": payload_hex}) };
        let args = json!({"request": {"path": p.path, "payload_v2": payload_v2, "domain_id": domain}});
        emit("payout_signing", json!({"payout_id": payout_id, "path": p.path, "domain_id": domain}));
        Promise::new(self.mpc_signer.clone())
            .function_call("sign".to_string(), args.to_string().into_bytes(), env::attached_deposit(), MPC_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_payout_signed(payout_id))
    }

    #[private]
    pub fn on_payout_signed(&mut self, payout_id: u64, #[callback_result] r: Result<Value, PromiseError>) -> bool {
        let p = self.payouts.get_mut(payout_id as u32).unwrap();
        match r {
            Ok(sig) => {
                p.status = PayoutStatus::Signed;
                p.mpc_signature = Some(sig.to_string());
                emit("payout_signed", json!({"payout_id": payout_id}));
                true
            }
            Err(_) => {
                p.status = PayoutStatus::Pending;
                false
            }
        }
    }

    /// The relayer reports the destination-chain tx; the escrowed NEAR moves to treasury,
    /// which funded the destination transfer.
    pub fn mark_payout_settled(&mut self, payout_id: u64, dest_tx: String) {
        self.assert_owner();
        let p = self.payouts.get_mut(payout_id as u32).expect("no payout");
        require!(p.status == PayoutStatus::Signed, "not signed");
        p.status = PayoutStatus::Settled;
        p.dest_tx = Some(dest_tx.clone());
        let amt = p.amount;
        self.payout_escrow = self.payout_escrow.saturating_sub(amt);
        Promise::new(self.treasury.clone()).transfer(amt);
        emit("payout_settled", json!({"payout_id": payout_id, "dest_tx": dest_tx}));
    }

    // ------------------------------------------------------------ views (X-2)

    pub fn get_config(&self) -> Value {
        json!({"owner": self.owner, "treasury": self.treasury, "quorum": self.quorum, "mpc_signer": self.mpc_signer,
               "agent_methods": AGENT_METHODS, "agent_key_allowance": AGENT_KEY_ALLOWANCE})
    }
    pub fn get_enclave(&self, account: AccountId) -> Option<Value> {
        self.enclaves.get(&account).map(|e| json!({"enclave": e, "score": e.rep.score()}))
    }
    pub fn list_enclaves(&self, from: u32, limit: u32) -> Vec<Value> {
        self.enclaves.values().skip(from as usize).take(limit as usize).map(|e| json!({"enclave": e, "score": e.rep.score()})).collect()
    }
    pub fn get_treaty(&self, treaty_id: u64) -> Option<Treaty> {
        self.treaties.get(treaty_id as u32).cloned()
    }
    pub fn list_treaties(&self, from: u32, limit: u32) -> Vec<Treaty> {
        self.treaties.iter().skip(from as usize).take(limit as usize).cloned().collect()
    }
    pub fn get_dispute(&self, dispute_id: u64) -> Option<Dispute> {
        self.disputes.get(dispute_id as u32).cloned()
    }
    pub fn list_disputes(&self, from: u32, limit: u32) -> Vec<Dispute> {
        self.disputes.iter().skip(from as usize).take(limit as usize).cloned().collect()
    }
    pub fn list_judges(&self) -> Vec<Judge> {
        self.judges.iter().cloned().collect()
    }
    pub fn list_payouts(&self, from: u32, limit: u32) -> Vec<Payout> {
        self.payouts.iter().skip(from as usize).take(limit as usize).cloned().collect()
    }
    pub fn get_binding(&self, dispute_id: u64) -> String {
        let d = self.disputes.get(dispute_id as u32).expect("no dispute");
        binding(env::current_account_id().as_str(), dispute_id, &d.evidence_sha256)
    }
    /// C-5: liabilities the contract must always cover.
    pub fn audit(&self) -> Value {
        let (mut free, mut locked) = (0u128, 0u128);
        for e in self.enclaves.values() {
            free += e.free.as_yoctonear();
            locked += e.locked.as_yoctonear();
        }
        let liabilities = free + locked + self.dispute_escrow.as_yoctonear() + self.payout_escrow.as_yoctonear();
        let balance = env::account_balance().as_yoctonear();
        json!({"free": free.to_string(), "locked": locked.to_string(), "dispute_escrow": self.dispute_escrow,
               "payout_escrow": self.payout_escrow, "liabilities": liabilities.to_string(), "balance": balance.to_string(),
               "solvent": balance >= liabilities})
    }
}

#[cfg(test)]
mod tests;
