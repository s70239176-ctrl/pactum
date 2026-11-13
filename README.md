# Pactum

**Pactum is the on-chain diplomatic layer for autonomous AI agents.** Every agent is a sovereign enclave that locks real collateral and writes natural-language treaties. When a treaty is breached, verifiable multi-model reasoning decides the outcome, and everything settles through NEAR Intents, Chain Signatures and NEAR AI Cloud TEEs.

Built for **NEAR HACKATHON: Build Beyond Boundaries** (2026-11-01 → 2026-11-14).
Tracks: primary `agents`, `swarms`, `security`; secondary `privacy`, `business`, `open`.
**Hosted demo:** https://pactum-int.vercel.app. It opens on live testnet state from `pactum.stunner70.testnet`; switch to **Demo** for the simulation. The **Simulations** page replays the scripted run and lists the real on-chain refusals with transaction links.
Design: [ARCHITECTURE.md](ARCHITECTURE.md) · Rules the code enforces: [RULES.md](RULES.md) (rule ids like `R-ROB-2` are cited in code and tests).

**The problem.** AI agents are starting to make deals with each other: an oracle for a lending vault, insurance for a market maker. Those deals are either unenforceable or need a human court, and an agent holding a full-access key can simply walk away with the money. Pactum gives every agent a sub-account it can't drain. Bonds sit in escrow, and a dispute is decided by several AI models running in TEEs, whose signatures the contract checks itself.

---

## Do X → See Y (under 3 minutes, no wallet, no API key)

Requires Node ≥ 22.18. Rust is only needed for step 6.

| # | Do | See |
|---|---|---|
| 1 | `cd offchain && npm install` | 3 packages: `near-api-js@7.4.0`, `@noble/curves@2.4.0`, `@noble/hashes@2.4.0` |
| 2 | `npm run sim` | The full lifecycle in about 2 s. **4 enclaves** are created with function-call keys; **3 treaties** are negotiated and escrowed; **9 rob attempts** each print `REFUSED: <reason>`; **3 disputes** are each judged by 3 TEE-format signatures; rulings are `CRITICAL_BREACH`, `MALICIOUS_REPORT` and `FEED_CONFLICT`; a 6 NEAR payout is queued for **Base** through Chain Signatures; the run ends with `rob attempts refused: 9/9` |
| 3 | `npm run verify` | Every judge signature is independently re-recovered to its signer address, each quorum is recomputed and matches the recorded ruling, and each refusal is listed. Ends with `all checks passed` |
| 4 | `npm run status` | Tables of enclaves (free / escrow / trust / frozen), treaties with escrow, and disputes with rulings |
| 5 | `node ../scripts/serve.mjs`, then open http://localhost:5173 (or https://pactum-int.vercel.app) | The landing page, then **Enter command**: live testnet metrics, network topology, treaty registry, tribunal ruling record, event history. Use **Simulations** → **Jump to end** for the replayed run (9/9 attacks blocked) |
| 6 | `cd ../contract && cargo test` (Linux, macOS or WSL) | `24 passed`. This includes every contract-level `R-ROB-*` refusal, the full lifecycle, and `ts_signed_vote_verifies_on_chain`: a vote signed by the TypeScript judge is accepted by the Rust contract |
| 7 | `cd ../offchain && npm test` | `pass 7`, including the known-answer check that key `0x01…01` maps to address `0x1a642f…14f1` |

All of this runs in **simulation mode** (RULES D-9): scripted agents, and judges that sign with local keys in **exactly** the wire format NEAR AI Cloud uses. Every simulated artifact is labeled `simulation`.

---

## NEAR kits used, and why

| Kit | Why Pactum needs it | Where | Status |
|---|---|---|---|
| **Sub-accounts + named accounts** | Every agent is `<name>.pactum.<owner>.testnet`, created by the contract. It's a sovereign identity whose only key can do nothing except call Pactum | `register_enclave` in [contract/src/lib.rs](contract/src/lib.rs) | contract + tests ✔ · testnet run pending |
| **Function-call access keys** | An agent runtime can never hold a key that moves money. The key allows 7 methods and a 0.25 NEAR gas allowance. Bonds come from the escrow ledger, so agents never need to attach deposits | `AGENT_METHODS`, `add_access_key_allowance` | contract ✔ · runtime refusals R-ROB-2/3 in the testnet script |
| **Meta transactions (NEP-366)** | Agents act without holding gas; a relayer pays | `metaCall` in [offchain/src/chain.ts](offchain/src/chain.ts) | testnet run pending |
| **NEAR AI Cloud** (Intel TDX + NVIDIA confidential GPUs) | Private dispute reasoning. Each verdict is signed **inside the TEE** over `model:sha256(request):sha256(response)`. The contract recovers the signer with `ecrecover` and matches it to the attested `signing_address`, so a relayer can't change a verdict (R-ROB-5) or replay it (R-ROB-6) | `NearAiTee`, `fetchAttestation` in [offchain/src/tee.ts](offchain/src/tee.ts); `recover_eip191` in the contract | format ✔ (from docs.near.ai) · live models need `NEAR_AI_API_KEY` |
| **Chain Signatures** | Agents whose home is Base, Ethereum, Solana or Bitcoin get paid there. The payout is signed by the MPC network (`v1.signer-prod.testnet`) on a per-payout path `pactum/<enclave>/<id>` | `request_payout_signature` | contract + tests ✔ · testnet `sign()` call in the testnet script |
| **NEAR Intents + 1-Click Swap API** | Funding collateral from any chain (for example USDC on Base → wNEAR) | [offchain/src/intents.ts](offchain/src/intents.ts), `npm run sim -- --quote` | `dry: true` quotes only. Intents has no testnet (HACKATHON.md Q-007); real deposits are mainnet-only and need the human's confirmation |
| OutLayer / Agents-on-Intents | Custody patterns | — | not used yet (stretch goal) |

---

## Live evidence

| What | Network | Evidence | Re-verify |
|---|---|---|---|
| 3 rulings, 9 TEE-format votes, 9 refusals | simulation | [evidence/sim-evidence.json](evidence/sim-evidence.json) | `cd offchain && npm run verify` |
| TS-signed vote accepted by the Rust contract | unit test | [contract/src/fixtures/ts_vote.json](contract/src/fixtures/ts_vote.json) | `cargo test ts_signed_vote` |
| Full testnet lifecycle (below) | **testnet** | [evidence/testnet-evidence.json](evidence/testnet-evidence.json) | open each link; `cd offchain && npm run status -- --chain` |
| NEAR AI Cloud attestation reports | NEAR AI Cloud | *pending `NEAR_AI_API_KEY`. The testnet judges used simulated TEE keys (labeled `simulation`); with a key, reports are saved to `evidence/attestations/` and their sha256 equals each judge's on-chain `attestation_sha256`* | `sha256sum evidence/attestations/*.json` vs `list_judges` |
| NEAR Intents deposit | **mainnet** | *none yet: needs an explicit yes per transaction (RULES P-1/P-2)* | — |

### Testnet run, 2026-11-13: contract [`pactum.stunner70.testnet`](https://testnet.nearblocks.io/address/pactum.stunner70.testnet)

Wasm built with `cargo near build` (326,258 bytes, sha256 `2b252d2d490215648e369b00bd3e79227642e792dbfff11d1ce1c8ea4377fbd2`).

| Step | Proves | Result | Tx |
|---|---|---|---|
| Create contract account | protocol is a named sub-account of the owner (A-1) | ✔ | [5LZmhuSp…](https://testnet.nearblocks.io/txns/5LZmhuSpNt2X3yipiiAHKruQyr9uoW8YdpPwN9wekjEe) |
| Deploy + init | quorum 2, MPC signer `v1.signer-prod.testnet` | ✔ | [BqEaki36…](https://testnet.nearblocks.io/txns/BqEaki36pttZ6jUUBk9Dp6os67CVnMGbEsh773wLFdAR) |
| Register judges 0–2 | judge signing addresses bound on-chain (A-5) | ✔ | [GPgENeS7…](https://testnet.nearblocks.io/txns/GPgENeS7jRekJZDzoRogfHZNmyxQ818GzKJAg5Kp1pzB) · [9nPmp6M8…](https://testnet.nearblocks.io/txns/9nPmp6M8TdCHnZgycfjAyipj1ubQoMhHtUtHiX8QWxxn) · [DPV9W9Hw…](https://testnet.nearblocks.io/txns/DPV9W9HwaWajdjTZKaboc6Mxs5xmrrFH37HefErCVeCX) |
| Register enclaves atlas, meridian, mallory | contract creates sub-accounts holding only a function-call key (A-2, A-3) | ✔ | [4MhxaCPz…](https://testnet.nearblocks.io/txns/4MhxaCPznJFYKfAz96TwZL47TC9DyDnnMMTxLuD3emiu) · [9QkYa2w6…](https://testnet.nearblocks.io/txns/9QkYa2w6e1qjc4NZC4aLFUJVHyN2c6RgkxUuFRGwxfRR) · [DHaaNZ1u…](https://testnet.nearblocks.io/txns/DHaaNZ1uLyNNapYL8qyUUL9QCcxWVcoyRC6hM78bfXXt) |
| `propose_treaty` (meta-tx) | agent acts gaslessly; 0.2 NEAR moves free → escrow | ✔ | [4EmBnncJ…](https://testnet.nearblocks.io/txns/4EmBnncJAdeXQ7qh87Xcsjk52ZQkjjXzaXJC5NPJR9Ay) |
| `ratify` (meta-tx) | treaty ACTIVE; 0.3 NEAR escrowed | ✔ | [EHx341EZ…](https://testnet.nearblocks.io/txns/EHx341EZWuYC18vdUgTRjcMnofGLLtup7rPSeUA1R3nX) |
| **R-ROB-1** withdraw locked bond | escrow can't be withdrawn | refused: `insufficient free collateral` | [7cprr3Fi…](https://testnet.nearblocks.io/txns/7cprr3FiMTHQL3QoNj5sGYLFTekrUZ9wD4ZkKrQcTibV) |
| **R-ROB-2** agent key calls `set_quorum` | runtime enforces the method allow-list | refused: `DelegateActionAccessKeyError: MethodNameMismatch` | [BMaKvZFg…](https://testnet.nearblocks.io/txns/BMaKvZFg6AtkV5iNhnfw45KcvXAhCC3KSctU1JLvK4gx) |
| **R-ROB-3** agent key attaches 0.5 NEAR | function-call keys can't move NEAR | refused: `DelegateActionAccessKeyError: DepositWithFunctionCall` | [GvFLf37i…](https://testnet.nearblocks.io/txns/GvFLf37iZmV7wwiAxCxskWqxT2TNcP5uALq6M7PZWCRo) |
| **R-ROB-4** outsider files dispute | only parties can dispute | refused: `party only` | [B1o5RBKZ…](https://testnet.nearblocks.io/txns/B1o5RBKZ9VzajLyjaQoFicikA4ZQhKX32JHFg2tVLnPv) |
| **R-ROB-7** ratify with altered terms | treaty can't be re-ratified | refused: `not proposed` ¹ | [2QEbFhTy…](https://testnet.nearblocks.io/txns/2QEbFhTyezVXi9TCD3dA7WqKAbBhAtgx8MB3V6CwGGT1) |
| **R-ROB-8** agent calls an owner method | owner-only admin | refused before reaching the chain ² | — |
| **R-ROB-10** bond above self-imposed cap | mallory capped itself at 0.25 NEAR | refused: `bond exceeds enclave's self-imposed cap` | [5fCXLJwF…](https://testnet.nearblocks.io/txns/5fCXLJwFFH3eRL9rqS6hAdF7GxkFLPVkusgpgUgiUJWB) |
| `file_dispute` (meta-tx) | evidence sha256 committed on-chain | ✔ | [Dey4N4zY…](https://testnet.nearblocks.io/txns/Dey4N4zYcfE3P8gefPz1NJqx6svWa8vGSzJSmnna35ED) |
| **R-ROB-5** forged / duplicated votes | duplicate judge counts once; wrong key ignored | refused: `no quorum among valid judge signatures` | [GrroduA9…](https://testnet.nearblocks.io/txns/GrroduA9Kfok4ygxaE6E3RFvbW7W1VgyoY17mVCwNJRA) |
| **R-ROB-6** replayed vote (other dispute id) | votes are bound to dispute + evidence | refused: `no quorum among valid judge signatures` | [EcoLvzoM…](https://testnet.nearblocks.io/txns/EcoLvzoMyruVEPw269qtBCnTdRAN3PQvsXWLuXf6AaoX) |
| `submit_verdicts` | `ecrecover` of 3 signatures on-chain → **CRITICAL_BREACH** (3843 bps); meridian's 0.3 NEAR bond slashed | ✔ | [CM3uVtxs…](https://testnet.nearblocks.io/txns/CM3uVtxsuAHsuny8ePSuwHqfkXPXioNGQLjneDkMjAPu) |
| Chain Signatures `sign()` | MPC network returned a secp256k1 signature for the Base payout, path `pactum/atlas.pactum.stunner70.testnet/0` (payout status `Signed`) | ✔ | [AiQrTbnh…](https://testnet.nearblocks.io/txns/AiQrTbnhA5BQyBuFaA6P3oZqMJRKx7XF38Q2AUdrDtfs) |

Final state: `audit()` → liabilities 1.5 NEAR, `solvent: true`. Treaty #0 `Closed`, dispute #0 `Resolved`.

¹ The treaty was already ACTIVE, so the contract refused at the state check before reaching the terms-hash check. The terms-hash refusal itself is covered by `rob7_ratify_altered_terms` in `cargo test` and by the sim.
² The script sent this one as a direct transaction from mallory's account, which only holds 0.1 NEAR, so the client refused it for insufficient balance. That's a script bug, not an on-chain refusal. The owner-only check is covered by `rob8_outsider_cannot_admin` in `cargo test`. Next run: send it as a meta-transaction.

This table is updated after every live run.

---

## How a dispute is decided (D-3 … D-7)

1. The plaintiff files `evidence_uri` + `sha256`. The document must name the accused, the treaty id and the contract.
2. Each judge re-fetches the evidence (SSRF-guarded), checks the hash, and reads **two telemetry feeds on different hosts**. If the feeds disagree by more than 5%, the result is `FEED_CONFLICT` (full refund, no penalty).
3. The judge sends the facts to its model. The request contains `pactum:v1|<contract>|<dispute>|<evidence sha256>`, which binds the vote to this dispute.
4. The TEE signs the exact request and response bytes. The contract recovers each signer, needs **2 of 3** registered judges to agree, and takes the median metric.
5. **Clamp:** under 5% shortfall, a breach becomes `NORMAL`; under 25%, `CRITICAL_BREACH` is capped at `ELEVATED_RISK`.
6. **Settlement:** a full slash, a 25% slash (a second one closes the treaty), a 10% fee, a forfeit to the defendant, or a refund. NEAR payouts are transferred; other chains go through Chain Signatures.

## Run it on testnet (real transactions)

```bash
cp .env.example .env       # fill OWNER_ACCOUNT / OWNER_KEY / PACTUM_CONTRACT yourself
cd offchain && npm run setup    # generates agent function-call keys + judge keys into .env
cd ../contract && cargo near build non-reproducible-wasm
cd ../offchain && npm run testnet -- --deploy        # prints the plan, signs nothing
cd ../offchain && npm run testnet -- --deploy --yes  # executes, writes evidence/testnet-evidence.json
node ../scripts/serve.mjs   # http://localhost:5173/?contract=<PACTUM_CONTRACT>
```

Keys live only in `.env`, which is git-ignored. Agents only ever hold function-call keys.

## Real vs. simulated (for AI and human judges)

- **Real and tested:** the contract (24 tests); on-chain `ecrecover` of TEE-format signatures; quorum, clamp and settlement; enclave sub-account creation with function-call keys; the escrow ledger and the solvency `audit()` view; the Chain Signatures `sign` request; the evidence hash and feed checks; and the TS ↔ Rust signature compatibility.
- **Simulated in `npm run sim`:** the judges (local keys, scripted reasoning); the ledger (a TypeScript mirror of the contract with the same refusal strings); and the runtime refusals for function-call keys (R-ROB-2/3). These become real on-chain refusals in `npm run testnet`.
- **Real on testnet (2026-11-13):** deployment, enclave sub-accounts, meta-tx treaty, 9 on-chain refusals with tx hashes, on-chain ruling, and an MPC signature from Chain Signatures (see Live evidence).
- **Not yet done:** live NEAR AI Cloud judges (needs an API key), a mainnet Intents deposit (needs a yes per transaction), and building and broadcasting the destination-chain transaction after the MPC signs (the payload is currently a hash of the canonical payout).

## Baseline, libraries, disclosure (Q-002 / Q-005)

- All code was written during the hackathon window. A first prototype (v1, ed25519 judge keys held off-TEE) was written on 2026-11-12 in this same repo and replaced by this design.
- Libraries: `near-sdk 5.30.1`, `near-api-js 7.4.0`, `@noble/curves 2.4.0`, `@noble/hashes 2.4.0`; for tests, `k256 0.13` and `sha3 0.10`. Contract and SDK patterns come from [near/agent-skills](https://github.com/near/agent-skills). The code was written with Claude Code.
- License: MIT ([LICENSE](LICENSE)).

## Repo layout

```
contract/src/lib.rs        enclaves · escrow · treaties · disputes · TEE vote verification · settlement · Chain Signatures
contract/src/tests.rs      24 tests named after RULES.md ids
offchain/src/tee.ts        EIP-191 TEE votes (SimTee + NearAiTee), attestation fetch
offchain/src/judge.ts      evidence -> request (with binding) -> signed vote
offchain/src/evidence.ts   hash, binding, dual-feed and SSRF checks
offchain/src/ledger.ts     contract mirror for sim mode
offchain/src/sim.ts        scripted end-to-end run + rob path
offchain/src/testnet.ts    the same flow with real testnet transactions (--yes required)
offchain/src/chain.ts      near-api-js client, meta-tx relayer
offchain/src/verify.ts     independent re-verification of evidence files
offchain/src/status.ts     CLI dashboard (sim or --chain)
frontend/index.html        war room (no build step)
evidence/                  sim evidence (+ testnet / attestations once run)
```
