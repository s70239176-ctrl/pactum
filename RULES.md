# Pactum: RULES

Written before any contract code. The contract, the agents and the tests must match this file. If code and RULES.md disagree, the code is wrong; changing a rule needs the human's approval.

Every rule has an id. Tests and the README's evidence table refer to these ids (for example, refusal `R-ROB-2`).

---

## Part A: Process rules (from HACKATHON.md, non-negotiable)

| id | Rule |
|---|---|
| P-1 | Never without the human's explicit yes: send the submission (print the full JSON first), post on X or any network, make the repo public, push or force-push, **sign transactions, spend tokens, or deploy to mainnet**, or commit secrets. |
| P-2 | **Testnet first.** Mainnet is used only for NEAR Intents legs (no Intents testnet exists, Q-007), with tiny amounts and a separate dev account, after the human confirms each transaction. |
| P-3 | Keys live only in `.env` (git-ignored) or the OS keychain. `.env.example` lists variable names with empty values. A pre-commit check scans for `ed25519:` private keys, `sk-` API keys and JWTs. |
| P-4 | Never guess addresses, endpoints or SDK versions: take them from docs.near.org, docs.near-intents.org, or near/agent-skills, and cite the source in ARCHITECTURE.md. |
| P-5 | Never create or invent the prize-payout account or any submission field. The human supplies them all. |
| P-6 | The README is written for human judges and AI judges alike, and is kept current: a one-sentence definition, "Do X → See Y" steps under 3 minutes, every NEAR kit with the reason it's used, and a live evidence table. |
| P-7 | Disclose the pre-hackathon baseline and reused code (Q-002/Q-005). The earlier `pactum/` prototype in this folder dates from 2026-11-12, inside the window, and is listed in the README. |

---

## Part B: Actors and accounts

| id | Rule |
|---|---|
| A-1 | The protocol account is `pactum.<owner>.testnet`. The owner holds the only full-access key, and it never runs inside an agent runtime. |
| A-2 | Every agent is a **sovereign enclave** at `<name>.pactum.<owner>.testnet`, created by the contract on `register_enclave`. A name already taken is refused. |
| A-3 | An enclave's runtime holds only **function-call access keys** with `receiver_id = pactum.<owner>.testnet`, an explicit method allow-list (`propose_treaty`, `ratify`, `file_dispute`, `request_exit`, `set_policy`, `withdraw_free_collateral`) and an allowance of at most 0.25 NEAR for gas. |
| A-4 | Agent actions are sent as **NEP-366 meta transactions** through the Pactum relayer, so agents need no gas balance. The relayer only forwards delegates whose receiver is the Pactum contract. |
| A-5 | Judges are registered by the owner as `{judge_id, model, tee_signing_pubkey (ed25519), attestation_hash, active}`. The signing key comes from the NEAR AI Cloud attestation report (`signing_algo=ed25519`), and `attestation_hash` is the sha256 of the raw report. |

## Part C: Collateral and escrow

| id | Rule |
|---|---|
| C-1 | Collateral is deposited with `deposit_collateral` (attached NEAR). NEP-141 stablecoins (via `ft_transfer_call`) are a stretch goal. An Intents-funded deposit arrives the same way, after the swap settles. |
| C-2 | Each enclave has `free` and `locked` balances. Only `free` can be withdrawn, and only by the enclave itself. |
| C-3 | Creating or ratifying a treaty moves the bond `free → locked` (escrow). There is no other path into escrow. |
| C-4 | While a treaty is ACTIVE, DISPUTED or EXITING, its locked bonds cannot be withdrawn, transferred or re-used by anyone, including the owner. |
| C-5 | **Invariant:** the contract's NEAR balance ≥ Σ free + Σ locked + open dispute bonds + storage. Every state-changing test checks it. |
| C-6 | A balance is always deducted **before** any outgoing transfer or cross-contract call. Failed transfers are restored in a private callback that never panics (docs.near.org security checklist). |
| C-7 | An agent may set its own `max_bond` and a `guardian`. The guardian can only freeze or unfreeze the enclave. A frozen enclave cannot propose, ratify or withdraw. |

## Part D: Treaties

| id | Rule |
|---|---|
| T-1 | A treaty has: parties A and B, `terms` (natural language, ≤ 4000 bytes), `terms_hash` = sha256(terms), `bond_a`, `bond_b`, `duration_ns`, `notice_ns`, `params` (≤ 16 key→number pairs, e.g. `{"uptime_floor_bps":9850}`), up to 2 `telemetry_urls` (https only) and a `payout` target per party (`near:<account>` or `<chain>:<address>`). |
| T-2 | States: `PROPOSED → ACTIVE → (DISPUTED ↔ ACTIVE) → EXITING → CLOSED`, plus `PROPOSED → CANCELLED` and `PROPOSED → EXPIRED`. No other transitions. |
| T-3 | `propose_treaty` locks A's bond. `ratify` must quote the exact `terms_hash` and locks B's bond. A mismatched hash is refused (`R-TREATY-1`). |
| T-4 | A proposal can be cancelled by A, or it expires after 24 h; either way A's bond returns to free. |
| T-5 | When `duration_ns` elapses with no open dispute, anyone may call `conclude`: both bonds are released to free and both parties gain `honored`. |
| T-6 | Either party may `request_exit`, which starts `notice_ns`. After it, anyone may `execute_exit`, which releases the bonds, provided no dispute is open. |

## Part E: Disputes and adjudication

| id | Rule |
|---|---|
| D-1 | Only a party to an ACTIVE or EXITING treaty may file. One open dispute per treaty at a time. The dispute bond is ≥ 0.1 NEAR, taken from the plaintiff's free balance. |
| D-2 | A filing carries `allegation` (≤ 2000 bytes), `evidence_uri` (https, ≤ 512 bytes) and `evidence_sha256` (64 lowercase hex). |
| D-3 | Judges must reject evidence when: the hash of the raw fetched bytes ≠ `evidence_sha256`; the document doesn't name the defendant, the treaty id and the contract; there are fewer than 2 feeds; the feeds are on the same host; a feed is unreachable; or the feeds diverge by more than 5%. The result is `NO_EVIDENCE` or `FEED_CONFLICT`. |
| D-4 | A verdict is one of `CRITICAL_BREACH`, `ELEVATED_RISK`, `NORMAL`, `MALICIOUS_REPORT`, `FEED_CONFLICT` or `NO_EVIDENCE`, plus `metric_bps` (the shortfall against the covenant baseline) and a rationale of ≤ 400 chars. |
| D-5 | A judge's vote is valid only if its ed25519 signature verifies on-chain against that judge's registered TEE key, the judge is active, and the signed content binds the contract id, dispute id, evidence sha256, verdict and metric. |
| D-6 | Duplicate votes from the same judge count once. The outcome needs **quorum = 2 of 3** valid votes for the same verdict; `metric_bps` is the median of the agreeing votes. |
| D-7 | **Clamp:** under 500 bps, a breach verdict becomes `NORMAL`. Under 2500 bps, `CRITICAL_BREACH` becomes `ELEVATED_RISK`. At 2500 bps or more, `MALICIOUS_REPORT` becomes `ELEVATED_RISK`. Both the raw and the clamped verdict are stored. |
| D-8 | With no quorum within 72 h, anyone may `expire_dispute`: the dispute bond is refunded and the treaty returns to its previous state. |
| D-9 | In `sim` mode, judges are deterministic scripts that sign with locally generated ed25519 keys and follow exactly the same rules D-3 to D-7. Every sim output is labeled `simulation`. |

## Part F: Settlement

| id | Verdict | Effect |
|---|---|---|
| S-1 | `CRITICAL_BREACH` | 100% of the defendant's bond goes to the plaintiff's payout target. Dispute bond refunded. Treaty CLOSED, plaintiff's bond released. Defendant +1 breach. |
| S-2 | `ELEVATED_RISK` | 25% of the defendant's bond goes to the plaintiff. Dispute bond refunded. Treaty returns to ACTIVE. A **second** elevated verdict against the same party closes the treaty. |
| S-3 | `NORMAL` | 10% of the dispute bond goes to the treasury; the rest is refunded. Treaty returns to ACTIVE. |
| S-4 | `MALICIOUS_REPORT` | The full dispute bond goes to the defendant. Plaintiff +1 malicious. Treaty returns to ACTIVE. |
| S-5 | `FEED_CONFLICT` / `NO_EVIDENCE` | Full refund. Treaty returns to ACTIVE. |
| S-6 | Payout to `near:<account>` is a direct transfer. Payout to any other chain is recorded `PENDING`, then signed through **Chain Signatures** (`sign` on the MPC contract, `path = "pactum/<enclave>/<payout_id>"`, `domain_id` 0 for BTC/EVM and 1 for Solana) → `SIGNED` → `SETTLED` once the relayer posts the destination tx hash. |
| S-7 | Reputation is a score from 0 to 1000 = 500 + 40·honored + 20·disputes_won + 10·ratified − 200·breaches − 80·elevated − 150·malicious, clamped. It is readable by anyone, and agents use it to price bonds. |

## Part G: Required on-chain refusals ("try to rob / break the treaty")

The `rob` scenario runs each of these on testnet. Each must **fail on-chain** with the stated message, and the failed tx hash goes into the README evidence table.

| id | Attack | Expected refusal |
|---|---|---|
| R-ROB-1 | Defendant withdraws its bond while the treaty is ACTIVE | `insufficient free collateral` |
| R-ROB-2 | Agent key calls a method outside its allow-list (e.g. `set_quorum`) | Runtime rejects it: `MethodNameMismatch` (function-call key limit) |
| R-ROB-3 | Agent key attaches a deposit or transfers NEAR away | Runtime rejects it: function-call keys can't transfer (`DepositWithFunctionCallAccessKey` / not permitted) |
| R-ROB-4 | Third party files a dispute on someone else's treaty | `party only` |
| R-ROB-5 | Relayer submits a forged or duplicated judge vote | `no quorum among valid judge signatures` |
| R-ROB-6 | Replay of a valid vote onto a different dispute | `no quorum among valid judge signatures` |
| R-ROB-7 | Ratify with altered terms | `terms changed; refusing to ratify` |
| R-ROB-8 | Owner tries to move locked escrow | No such method exists; `settle` is private to the verdict path. Documented and tested. |
| R-ROB-9 | Frozen enclave proposes | `enclave is frozen by its guardian` |
| R-ROB-10 | Bond above the agent's own cap | `bond exceeds enclave's self-imposed cap` |

## Part H: Transparency

| id | Rule |
|---|---|
| X-1 | Every state change emits a NEP-297 event (`standard: "pactum"`). The UI and CLI read only views and events. |
| X-2 | Views list enclaves, treaties, escrow balances, disputes, rulings, judges, payouts and reputation. |
| X-3 | The README evidence table lists for each important step: network, tx hash, explorer link, what it proves, and a one-line command to re-verify it. In `sim` mode it lists the equivalent signed artifacts, verifiable with `npm run verify`. |
| X-4 | NEAR AI Cloud attestation reports used by judges are saved under `evidence/attestations/` (no secrets), with their sha256 matching the on-chain `attestation_hash`. |
