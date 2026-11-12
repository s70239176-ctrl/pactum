//! Unit tests. Each test names the RULES.md ids it covers.
use super::*;
use k256::ecdsa::{SigningKey, VerifyingKey};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;
use sha3::{Digest, Keccak256};

const C: &str = "pactum.testnet";
const EVID: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ATT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PK: &str = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}
fn zero() -> NearToken {
    NearToken::from_yoctonear(0)
}
fn ctx(pred: &str, deposit: NearToken, ts: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(C)).predecessor_account_id(acc(pred)).attached_deposit(deposit).block_timestamp(ts).account_balance(near(1_000));
    testing_env!(b.build());
}

// --- TEE judge emulation: identical bytes to NEAR AI Cloud's EIP-191 signature ---
struct Tee {
    sk: SigningKey,
    model: String,
}
impl Tee {
    fn new(seed: u8, model: &str) -> Self {
        Tee { sk: SigningKey::from_bytes(&[seed; 32].into()).unwrap(), model: model.into() }
    }
    fn address(&self) -> String {
        let pt = VerifyingKey::from(&self.sk).to_encoded_point(false);
        hex(&Keccak256::digest(&pt.as_bytes()[1..])[12..])
    }
    fn vote(&self, judge_id: u32, dispute_id: u64, verdict: &str, metric: u32) -> TeeVote {
        let req = json!({"model": self.model, "messages": [{"role":"user","content": format!("{} judge this", binding(C, dispute_id, EVID))}]}).to_string();
        let content = json!({"verdict": verdict, "metric_bps": metric, "rationale": format!("judge {judge_id}")}).to_string();
        let resp = json!({"id":"chatcmpl-1","choices":[{"message":{"role":"assistant","content": content}}]}).to_string();
        let text = format!("{}:{}:{}", self.model, sha2(&req), sha2(&resp));
        let mut msg = format!("\x19Ethereum Signed Message:\n{}", text.len()).into_bytes();
        msg.extend_from_slice(text.as_bytes());
        let (sig, rec) = self.sk.sign_prehash_recoverable(&Keccak256::digest(&msg)).unwrap();
        let mut b = sig.to_bytes().to_vec();
        b.push(27 + rec.to_byte());
        TeeVote { judge_id, request_body: req, response_body: resp, signature: format!("0x{}", hex(&b)) }
    }
}
fn sha2(s: &str) -> String {
    sha256hex(s.as_bytes())
}

struct W {
    c: Pactum,
    tees: Vec<Tee>,
}

fn enclave(c: &mut Pactum, name: &str, collateral: u128, payout: PayoutTarget) -> AccountId {
    ctx("operator.testnet", near(collateral).saturating_add(ENCLAVE_FUNDING), 0);
    let _ = c.register_enclave(name.into(), PK.parse().unwrap(), acc("operator.testnet"), payout, None, None);
    let a = acc(&format!("{name}.{C}"));
    ctx(C, zero(), 0);
    assert!(c.on_enclave_created(a.clone(), acc("operator.testnet"), zero(), Ok(())));
    a
}
fn near_payout(a: &str) -> PayoutTarget {
    PayoutTarget { chain: "near".into(), address: a.into() }
}

fn world(quorum: u32, judges: usize) -> W {
    ctx("owner.testnet", zero(), 0);
    let mut c = Pactum::new(acc("owner.testnet"), acc("treasury.testnet"), quorum, acc("v1.signer-prod.testnet"));
    let mut tees = vec![];
    for i in 0..judges {
        let t = Tee::new(i as u8 + 1, &format!("model/{i}"));
        ctx("owner.testnet", zero(), 0);
        c.register_judge(t.model.clone(), format!("0x{}", t.address()), SignatureKind::ProviderTee, ATT.into());
        tees.push(t);
    }
    enclave(&mut c, "atlas", 20, near_payout("atlas-owner.testnet"));
    enclave(&mut c, "meridian", 20, near_payout("meridian-owner.testnet"));
    W { c, tees }
}
fn atlas() -> AccountId {
    acc(&format!("atlas.{C}"))
}
fn meridian() -> AccountId {
    acc(&format!("meridian.{C}"))
}
fn free(w: &W, a: &AccountId) -> NearToken {
    w.c.enclaves.get(a).unwrap().free
}
fn locked(w: &W, a: &AccountId) -> NearToken {
    w.c.enclaves.get(a).unwrap().locked
}

fn treaty(w: &mut W) -> u64 {
    ctx(atlas().as_str(), zero(), 1);
    let id = w.c.propose_treaty(meridian(), "Meridian keeps ETH/USD oracle uptime >= 98.5%".into(), near(3), near(6), U64(1_000), U64(100), None, None);
    let h = w.c.get_treaty(id).unwrap().terms_hash;
    ctx(meridian().as_str(), zero(), 2);
    w.c.ratify(id, h);
    id
}
fn dispute(w: &mut W, tid: u64) -> u64 {
    ctx(atlas().as_str(), zero(), 3);
    w.c.file_dispute(tid, "oracle down 9h".into(), "https://e.example/incident.json".into(), EVID.into(), NearToken::from_millinear(500))
}

#[test] // A-2, C-1, C-3, T-3, D-5, D-6, S-1, S-7
fn full_lifecycle_critical_breach() {
    let mut w = world(2, 3);
    let tid = treaty(&mut w);
    assert_eq!(locked(&w, &atlas()), near(3));
    assert_eq!(locked(&w, &meridian()), near(6));
    let did = dispute(&mut w, tid);
    assert_eq!(w.c.get_treaty(tid).unwrap().status, TreatyStatus::Disputed);
    ctx("relayer.testnet", zero(), 4);
    let votes = vec![w.tees[0].vote(0, did, "CRITICAL_BREACH", 3843), w.tees[1].vote(1, did, "CRITICAL_BREACH", 3900), w.tees[2].vote(2, did, "ELEVATED_RISK", 3843)];
    assert_eq!(w.c.submit_verdicts(did, votes), Verdict::CriticalBreach);
    let t = w.c.get_treaty(tid).unwrap();
    assert_eq!(t.status, TreatyStatus::Closed);
    assert_eq!(locked(&w, &meridian()), zero());
    assert_eq!(free(&w, &meridian()), near(14)); // 20 - 6 slashed
    assert_eq!(free(&w, &atlas()), near(20)); // bond + dispute bond back
    let d = w.c.get_dispute(did).unwrap();
    assert_eq!((d.judges.len(), d.metric_bps), (2, Some(3900)));
    assert_eq!(w.c.enclaves.get(&meridian()).unwrap().rep.breaches, 1);
    assert_eq!(w.c.list_payouts(0, 9)[0].status, PayoutStatus::Settled);
    assert!(get_logs().iter().any(|l| l.contains("\"ruling\"")));
}

#[test] // R-ROB-1
#[should_panic(expected = "insufficient free collateral")]
fn rob1_withdraw_locked_bond() {
    let mut w = world(1, 1);
    treaty(&mut w);
    ctx(meridian().as_str(), zero(), 5);
    w.c.withdraw_free_collateral(near(15)); // free is 14, 6 locked
}

#[test] // C-2: withdrawal always goes to the immutable beneficiary
fn withdraw_free_goes_to_beneficiary() {
    let mut w = world(1, 1);
    ctx(meridian().as_str(), zero(), 5);
    let _ = w.c.withdraw_free_collateral(near(5));
    assert_eq!(free(&w, &meridian()), near(15));
    assert!(get_logs().iter().any(|l| l.contains("operator.testnet")));
}

#[test] // R-ROB-4
#[should_panic(expected = "party only")]
fn rob4_outsider_files_dispute() {
    let mut w = world(1, 1);
    let tid = treaty(&mut w);
    enclave(&mut w.c, "mallory", 5, near_payout("m.testnet"));
    ctx(&format!("mallory.{C}"), zero(), 3);
    w.c.file_dispute(tid, "x".into(), "https://e.example/x".into(), EVID.into(), NearToken::from_millinear(200));
}

#[test] // R-ROB-5: a vote signed by the wrong TEE key does not count
#[should_panic(expected = "no quorum")]
fn rob5_forged_vote() {
    let mut w = world(2, 3);
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    ctx("relayer.testnet", zero(), 4);
    let good = w.tees[0].vote(0, did, "CRITICAL_BREACH", 4000);
    let mut forged = w.tees[0].vote(0, did, "CRITICAL_BREACH", 4000);
    forged.judge_id = 1; // judge 1's slot, judge 0's key
    w.c.submit_verdicts(did, vec![good, forged]);
}

#[test] // R-ROB-5: duplicate vote counts once (D-6)
#[should_panic(expected = "no quorum")]
fn rob5_duplicate_vote() {
    let mut w = world(2, 3);
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    ctx("relayer.testnet", zero(), 4);
    let v = w.tees[0].vote(0, did, "CRITICAL_BREACH", 4000);
    w.c.submit_verdicts(did, vec![v.clone(), v]);
}

#[test] // R-ROB-5: tampered response body breaks the TEE signature
#[should_panic(expected = "no quorum")]
fn rob5_tampered_response() {
    let mut w = world(1, 1);
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    ctx("relayer.testnet", zero(), 4);
    let mut v = w.tees[0].vote(0, did, "NORMAL", 0);
    v.response_body = v.response_body.replace("NORMAL", "CRITICAL_BREACH");
    w.c.submit_verdicts(did, vec![v]);
}

#[test] // R-ROB-6: replay onto another dispute
#[should_panic(expected = "no quorum")]
fn rob6_replay_other_dispute() {
    let mut w = world(1, 1);
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    ctx("relayer.testnet", zero(), 4);
    let v = w.tees[0].vote(0, did + 5, "CRITICAL_BREACH", 4000);
    w.c.submit_verdicts(did, vec![v]);
}

#[test] // R-ROB-7
#[should_panic(expected = "terms changed")]
fn rob7_ratify_altered_terms() {
    let mut w = world(1, 1);
    ctx(atlas().as_str(), zero(), 1);
    let id = w.c.propose_treaty(meridian(), "x".into(), near(1), near(1), U64(10), U64(1), None, None);
    ctx(meridian().as_str(), zero(), 2);
    w.c.ratify(id, EVID.into());
}

#[test] // R-ROB-9
#[should_panic(expected = "frozen")]
fn rob9_frozen_enclave() {
    let mut w = world(1, 1);
    ctx(atlas().as_str(), zero(), 1);
    w.c.set_policy(None, Some(acc("guardian.testnet")));
    ctx("guardian.testnet", zero(), 2);
    w.c.set_frozen(atlas(), true);
    ctx(atlas().as_str(), zero(), 3);
    w.c.propose_treaty(meridian(), "x".into(), near(1), near(1), U64(10), U64(1), None, None);
}

#[test] // R-ROB-10
#[should_panic(expected = "self-imposed cap")]
fn rob10_bond_over_cap() {
    let mut w = world(1, 1);
    ctx(atlas().as_str(), zero(), 1);
    w.c.set_policy(Some(near(2)), None);
    w.c.propose_treaty(meridian(), "x".into(), near(3), near(1), U64(10), U64(1), None, None);
}

#[test] // R-ROB-8: owner has no path to locked escrow; owner-only methods refuse outsiders
#[should_panic(expected = "owner only")]
fn rob8_outsider_cannot_admin() {
    let mut w = world(1, 1);
    ctx(atlas().as_str(), zero(), 1);
    w.c.set_quorum(1);
}

#[test] // non-enclave cannot act
#[should_panic(expected = "caller is not an enclave")]
fn outsider_cannot_propose() {
    let mut w = world(1, 1);
    ctx("random.testnet", zero(), 1);
    w.c.propose_treaty(meridian(), "x".into(), near(1), near(1), U64(10), U64(1), None, None);
}

#[test] // A-2
#[should_panic(expected = "enclave name taken")]
fn duplicate_enclave_name() {
    let mut w = world(1, 1);
    enclave(&mut w.c, "atlas", 1, near_payout("x.testnet"));
}

#[test] // S-2 + anti-griefing
fn elevated_twice_closes() {
    let mut w = world(1, 1);
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    ctx("r.testnet", zero(), 4);
    assert_eq!(w.c.submit_verdicts(did, vec![w.tees[0].vote(0, did, "ELEVATED_RISK", 1500)]), Verdict::ElevatedRisk);
    let t = w.c.get_treaty(tid).unwrap();
    assert_eq!((t.status.clone(), t.bond_b), (TreatyStatus::Active, NearToken::from_millinear(4_500)));
    let did2 = dispute(&mut w, tid);
    ctx("r.testnet", zero(), 5);
    w.c.submit_verdicts(did2, vec![w.tees[0].vote(0, did2, "ELEVATED_RISK", 1500)]);
    assert_eq!(w.c.get_treaty(tid).unwrap().status, TreatyStatus::Closed);
}

#[test] // D-7 clamp, applied on-chain
fn clamp_rules() {
    assert_eq!(clamp(Verdict::CriticalBreach, 1000), Verdict::ElevatedRisk);
    assert_eq!(clamp(Verdict::CriticalBreach, 100), Verdict::Normal);
    assert_eq!(clamp(Verdict::ElevatedRisk, 499), Verdict::Normal);
    assert_eq!(clamp(Verdict::MaliciousReport, 3000), Verdict::ElevatedRisk);
    assert_eq!(clamp(Verdict::CriticalBreach, 2500), Verdict::CriticalBreach);
}

#[test] // S-4
fn malicious_report_pays_defendant() {
    let mut w = world(1, 1);
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    ctx("r.testnet", zero(), 4);
    w.c.submit_verdicts(did, vec![w.tees[0].vote(0, did, "MALICIOUS_REPORT", 0)]);
    assert_eq!(free(&w, &meridian()), NearToken::from_millinear(14_500));
    assert_eq!(w.c.enclaves.get(&atlas()).unwrap().rep.malicious, 1);
    assert_eq!(w.c.get_treaty(tid).unwrap().status, TreatyStatus::Active);
}

#[test] // S-5
fn feed_conflict_refunds() {
    let mut w = world(1, 1);
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    ctx("r.testnet", zero(), 4);
    w.c.submit_verdicts(did, vec![w.tees[0].vote(0, did, "FEED_CONFLICT", 0)]);
    assert_eq!(free(&w, &atlas()), near(17));
    assert_eq!(w.c.get_treaty(tid).unwrap().status, TreatyStatus::Active);
}

#[test] // S-6: non-NEAR payout queued, then sent to the MPC signer
fn cross_chain_payout_chain_signatures() {
    let mut w = world(1, 1);
    w.c.enclaves.get_mut(&atlas()).unwrap().payout = PayoutTarget { chain: "base".into(), address: "0x7a11a5000000000000000000000000000000a71a".into() };
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    ctx("r.testnet", zero(), 4);
    w.c.submit_verdicts(did, vec![w.tees[0].vote(0, did, "CRITICAL_BREACH", 9000)]);
    let p = w.c.list_payouts(0, 9)[0].clone();
    assert_eq!((p.status, p.amount, p.path.as_str()), (PayoutStatus::Pending, near(6), "pactum/atlas.pactum.testnet/0"));
    ctx("owner.testnet", NearToken::from_yoctonear(1), 5);
    let _ = w.c.request_payout_signature(0, EVID.into());
    assert_eq!(w.c.list_payouts(0, 9)[0].status, PayoutStatus::Signing);
}

#[test] // T-4, T-5, T-6
fn proposal_cancel_conclude_exit() {
    let mut w = world(1, 1);
    ctx(atlas().as_str(), zero(), 1);
    let p = w.c.propose_treaty(meridian(), "x".into(), near(1), near(1), U64(10), U64(1), None, None);
    w.c.cancel_proposal(p);
    assert_eq!(free(&w, &atlas()), near(20));

    let tid = treaty(&mut w); // activated at ts=2, duration 1000
    ctx("anyone.testnet", zero(), 2_000);
    w.c.conclude(tid);
    assert_eq!(w.c.get_treaty(tid).unwrap().status, TreatyStatus::Closed);
    assert_eq!(w.c.enclaves.get(&atlas()).unwrap().rep.honored, 1);
    assert_eq!(locked(&w, &atlas()), zero());
}

#[test] // D-8
fn dispute_expires_and_refunds() {
    let mut w = world(1, 1);
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    ctx("anyone.testnet", zero(), 3 + DISPUTE_TIMEOUT_NS);
    w.c.expire_dispute(did);
    assert_eq!(w.c.get_treaty(tid).unwrap().status, TreatyStatus::Active);
    assert_eq!(free(&w, &atlas()), near(17));
}

#[test] // C-5: liabilities track every movement
fn liabilities_accounting() {
    let mut w = world(1, 1);
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    let a = w.c.audit();
    assert_eq!(a["liabilities"], near(40).as_yoctonear().to_string());
    ctx("r.testnet", zero(), 4);
    w.c.submit_verdicts(did, vec![w.tees[0].vote(0, did, "CRITICAL_BREACH", 9000)]);
    // 6 NEAR left the contract to atlas's NEAR payout account
    assert_eq!(w.c.audit()["liabilities"], near(34).as_yoctonear().to_string());
}

#[test] // Cross-language: a vote signed by offchain/src/tee.ts verifies here.
fn ts_signed_vote_verifies_on_chain() {
    let f: Value = serde_json::from_str(include_str!("fixtures/ts_vote.json")).unwrap();
    ctx("owner.testnet", zero(), 0);
    let mut c = Pactum::new(acc("owner.testnet"), acc("treasury.testnet"), 1, acc("v1.signer-prod.testnet"));
    c.register_judge(f["model"].as_str().unwrap().into(), f["signing_address"].as_str().unwrap().into(), SignatureKind::ProviderTee, ATT.into());
    // Same seed as the TS fixture (0x11 * 32) must give the same address.
    assert_eq!(Tee::new(0x11, "x").address(), f["signing_address"].as_str().unwrap());
    let w_c = &mut c;
    enclave(w_c, "atlas", 20, near_payout("atlas-owner.testnet"));
    enclave(w_c, "meridian", 20, near_payout("meridian-owner.testnet"));
    let mut w = W { c, tees: vec![] };
    let tid = treaty(&mut w);
    let did = dispute(&mut w, tid);
    assert_eq!(did, 0);
    ctx("relayer.testnet", zero(), 4);
    let v = TeeVote {
        judge_id: 0,
        request_body: f["request_body"].as_str().unwrap().into(),
        response_body: f["response_body"].as_str().unwrap().into(),
        signature: f["signature"].as_str().unwrap().into(),
    };
    assert_eq!(w.c.submit_verdicts(did, vec![v]), Verdict::CriticalBreach);
}

#[test] // EIP-191 recovery matches the address derivation used by NEAR AI Cloud
fn eip191_recovery() {
    ctx("x.testnet", zero(), 0);
    let t = Tee::new(9, "m");
    let v = t.vote(0, 0, "NORMAL", 0);
    let text = tee_text(&SignatureKind::ProviderTee, "m", &v.request_body, &v.response_body);
    assert_eq!(recover_eip191(&text, &v.signature).unwrap(), t.address());
    assert_eq!(parse_vote(&v.response_body).unwrap().0, Verdict::Normal);
}
