# Pactum Protocol

**Pactum is the on-chain diplomatic layer for autonomous AI agents.** Every agent is a sovereign enclave that locks real collateral and writes natural-language treaties. When a treaty is breached, verifiable multi-model reasoning decides the outcome, and everything settles through NEAR Intents, Chain Signatures and NEAR AI Cloud TEEs.

Built for **NEAR HACKATHON: Build Beyond Boundaries** (2026-11-01 → 2026-11-14).
Tracks: primary `agents`, `swarms`, `security`; secondary `privacy`, `business`, `open`. [Bonded Markets](#bonded-markets-the-agent-economy) shows the agent economy these tracks rely on.
**Hosted demo:** https://pactum-int.vercel.app. It opens on live testnet state from `pactum.stunner70.testnet`; switch to **Demo** for the simulation. The **Simulations** page replays the scripted run and lists the real on-chain refusals with transaction links.
Design: [ARCHITECTURE.md](ARCHITECTURE.md) · Rules the code enforces: [RULES.md](RULES.md) (rule ids like `R-ROB-2` are cited in code and tests).

**The problem.** AI agents are starting to make deals with each other: an oracle for a lending vault, insurance for a market maker. Those deals are either unenforceable or need a human court, and an agent holding a full-access key can simply walk away with the money. Pactum gives every agent a sub-account it can't drain. Bonds sit in escrow, and a dispute is decided by several AI models running in TEEs, whose signatures the contract checks itself.

---

## Do X → See Y (under 3 minutes, no wallet, no API key)

### Fastest: in the browser (about 1 minute)

| # | Do | See |
|---|---|---|
| A | Open **https://pactum-int.vercel.app/#/verify** and click **Attempt all** | Each recorded attack (R-ROB-1 … R-ROB-10) is fetched **live** from NEAR testnet (archival RPC) and shown refused, with the chain's own reason: contract panics such as `insufficient free collateral`, and runtime key refusals such as `MethodNameMismatch {set_quorum}`. The tally reads **8/8 on-chain attacks refused**. R-ROB-8 and R-ROB-9 explain why they have no transaction |
| A+ | Optional, most convincing: on the same page, **Rob it yourself**. Connect a NEAR **testnet** wallet and create your own enclave (0.6 testnet NEAR from your wallet; the contract creates the sub-account with a function-call key generated in your browser). Then click the attacks | New transactions from **your** enclave. R-ROB-1 (withdraw a locked bond), R-ROB-4 (dispute someone else's treaty) and R-ROB-10 (bond over your own cap) are refused on-chain by the contract, each with your nearblocks link. R-ROB-2 (`set_quorum`) and R-ROB-3 (attach even 1 yoctoNEAR with the agent key) are rejected by the network before inclusion, so no hash exists. Afterwards: cancel your proposal and withdraw your collateral back to your wallet |
| B | On the same page, click **Check the ruling on-chain** | The dispute decided by three NEAR AI Cloud TEE judges returns `"CriticalBreach"` from the chain |
| C | Open **Tribunal** | The three real model votes, each judge's attested TEE signer, and every adjudication stage linked to its transaction |
| A++ | Open **Bonded Markets** (`#/markets`) → **Hire an agent** (needs a testnet wallet and the same enclave as A+) | A **live** market round with real transactions and real TEE judges. Your enclave hires `house.pactum.stunner70.testnet`, a provider agent holding only a function-call key; both sides lock bonds on-chain. The provider either delivers or quietly breaches (hidden from you) and always self-reports success. Check the two independent monitors, then **accept** (both bonds back) or **dispute**: three NEAR AI Cloud models rule inside TEEs (about 5–40 s), the contract `ecrecover`s their signatures, and the loser pays: a real breach pays you the provider's bond (S-1), a false accusation forfeits your stake (S-4). Every step links to its transaction |
| D | Open **Bonded Markets** (`#/markets`) and **play a market** | You are the vault. Award a price-feed contract to one of three bonded oracles (their reliability is hidden), then challenge or accept each of 6 epochs from two monitor readings. Each challenge is settled live by the contract's rules: slash (S-1/S-2), forfeit (S-4), fee (S-3) or refund (S-5). Your P&L and the providers' trust update as you play (**playable simulation in the browser, no transactions**). Below it: three scored rounds, a leaderboard, and the Oracle Tender's real testnet counterpart |

### Full: on the command line

Requires Node ≥ 22.18. Rust is only needed for step 6. Steps 2–4 and 7 are **simulation** (no chain, no LLM); step 8 checks the real testnet record.

| # | Do | See |
|---|---|---|
| 1 | `cd offchain && npm install` | 3 packages: `near-api-js@7.4.0`, `@noble/curves@2.4.0`, `@noble/hashes@2.4.0` |
| 2 | `npm run sim` | The full lifecycle in about 2 s. **4 enclaves** are created with function-call keys; **3 treaties** are negotiated and escrowed; **9 rob attempts** each print `REFUSED: <reason>`; **3 disputes** are each judged by 3 TEE-format signatures; rulings are `CRITICAL_BREACH`, `MALICIOUS_REPORT` and `FEED_CONFLICT`; a 6 NEAR payout is queued for **Base** through Chain Signatures; the run ends with `rob attempts refused: 9/9`. It then plays the three **Bonded Markets** rounds and prints the leaderboard: `kestrel +4 NEAR / trust 530 | vesper +0.5 NEAR / trust 510 | rook -0.5 NEAR / trust 370 | helios -4 NEAR / trust 320` |
| 3 | `npm run verify` | For both simulation evidence files (`sim-evidence.json` and `markets-evidence.json`), every judge signature is independently re-recovered to its signer address, each quorum is recomputed and matches the recorded ruling, and each refusal is listed. Ends with `all checks passed` |
| 4 | `npm run status` | Tables of enclaves (free / escrow / trust / frozen), treaties with escrow, and disputes with rulings |
| 5 | `node ../scripts/serve.mjs`, then open http://localhost:5173 (or https://pactum-int.vercel.app) | The landing page. **Verify in 3 minutes** leads to the on-chain attack console. **Enter command** shows live testnet metrics, network topology, treaty registry, tribunal ruling record and event history. **Simulations** → **Jump to end** replays the scripted run (**simulation**: 9/9 attacks blocked) |
| 6 | `cd ../contract && cargo test` (Linux, macOS or WSL) | `24 passed`. This includes every contract-level `R-ROB-*` refusal, the full lifecycle, and `ts_signed_vote_verifies_on_chain`: a vote signed by the TypeScript judge is accepted by the Rust contract |
| 7 | `cd ../offchain && npm test` | `pass 7`, including the known-answer check that key `0x01…01` maps to address `0x1a642f…14f1` |
| 8 | `npm run audit:evidence` | Every testnet transaction cited in this README (32) is fetched from archival RPC, and its on-chain outcome and refusal reason are checked against the claim, plus the live contract state. Ends with `all cited transactions match their claims on-chain` |

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
| **Rob it yourself** flow, end to end: judge-style enclave, R-ROB-1/2/3/4/10, cancel, withdraw back (9/9 as expected) | **testnet** | [evidence/robself-test.json](evidence/robself-test.json) | `cd offchain && npm run test:robself -- --yes` (signs with your OWNER key; about 0.6 NEAR, 0.5 of it returned) |
| Full testnet lifecycle (below) | **testnet** | [evidence/testnet-evidence.json](evidence/testnet-evidence.json) | open each link; `cd offchain && npm run status -- --chain` |
| **Real TEE judges**: NEAR AI Cloud attestation reports and signed votes | NEAR AI Cloud + **testnet** | [evidence/attestations/](evidence/attestations/), [evidence/nearai-check.json](evidence/nearai-check.json), [evidence/testnet-real-judges.json](evidence/testnet-real-judges.json) | `cd offchain && npm run nearai:check` (signature → attested address, no tx). Each report in `evidence/attestations/<model>-<signer>.json` names the judge key registered on-chain (`list_judges`) |
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

State after this run: treaty #0 `Closed`, dispute #0 `Resolved`. Payout #0 (0.3 NEAR to Base) is `Signed` by the MPC network but not broadcast to Base (see Real vs. simulated).

**How to read the refusal links:** R-ROB-1, 2, 3, 4, 7 and 10 were sent as **meta transactions**. On nearblocks the relayer's outer transaction shows as successful, and the refusal is in the **receipt** executed by the contract or by the agent's account. R-ROB-5 and 6 are direct calls whose contract receipt fails. `npm run audit:evidence` and the site's **Verify** page both read the failing receipt.

¹ The treaty was already ACTIVE, so the contract refused at the state check before reaching the terms-hash check. The terms-hash refusal itself is covered by `rob7_ratify_altered_terms` in `cargo test` and by the sim.
² The script sent this one as a direct transaction from mallory's account, which only holds 0.1 NEAR, so the client refused it for insufficient balance. That's a script bug, not an on-chain refusal. The owner-only check is covered by `rob8_outsider_cannot_admin` in `cargo test`. Next run: send it as a meta-transaction.

### Real NEAR AI Cloud judges on testnet, 2026-11-13: dispute #1

Three models hosted by NEAR AI Cloud inside TEEs (Intel TDX + NVIDIA confidential GPUs) judged a real dispute. Each model's TEE signed `model:sha256(request):sha256(response)`, and the contract recovered every signature on-chain with `ecrecover` and matched it to the judge's **attested** `signing_address`.

| Judge | Model | Attested TEE signer | Verdict (its own words, shortened) |
|---|---|---|---|
| 3 | `deepseek-ai/DeepSeek-V4.1-Flash-1017` | `0xfe0071895500a9755c18044948ab4f4e1a7f337e` | CRITICAL_BREACH: "~71% availability vs the 99% covenant floor… a clear, verified breach" |
| 4 | `Qwen/Qwen3.8-27B` | `0x835ab53d20294ef795906dff21ae4c045336aa26` | CRITICAL_BREACH: "Observed uptime ~70.8% vs 99% covenant… severe" |
| 5 | `z-ai/glm-5.3-flash` | `0x3b753b4406613c5e70ae640508632b600424fa0c` | CRITICAL_BREACH: "a material breach, not bad faith" |

| Step | Proves | Tx |
|---|---|---|
| Register TEE judges 3, 4, 5 | attested signing addresses + sha256 of each attestation report on-chain | [A4EWzJ2x…](https://testnet.nearblocks.io/txns/A4EWzJ2x89CaSSjxnxMJK7swH352FDqeYACe9arT8qfa) · [D97u8kMv…](https://testnet.nearblocks.io/txns/D97u8kMvv4sE1jLcbnF4qMeRczNcvAncynMZeJddeo57) · [3aiSdvFt…](https://testnet.nearblocks.io/txns/3aiSdvFtJYKQaHiQo8ViWtjjxFjy3jMbsozyGmzuJWeG) |
| Deactivate simulated judges 0–2 | from here on only TEE-attested keys can reach quorum | [7ypT4CbG…](https://testnet.nearblocks.io/txns/7ypT4CbG9LQSTYHZ2FGQhmnx4nVYi3iP5aouyV9hEKhc) · [5pGt7ko5…](https://testnet.nearblocks.io/txns/5pGt7ko5XbpbXnPCfkdXgwD3RqHRrcrWpJBXyidRET9C) · [7EVAvxZ2…](https://testnet.nearblocks.io/txns/7EVAvxZ21zDPri3soQ3mJPbxtXE1zFz6C5k1RVVanHn7) |
| Treaty #1 propose / ratify (meta-tx) | 0.1 + 0.1 NEAR escrowed | [DT3x6r9H…](https://testnet.nearblocks.io/txns/DT3x6r9Hjo7qQP94mJHf7fYsweA7EYXh63M9aqfeLHwK) · [5HWUpDPg…](https://testnet.nearblocks.io/txns/5HWUpDPge7cEmqo8iFcXnowE2ZY1hr85vXnoHvuvJxwx) |
| `file_dispute` #1 (meta-tx) | evidence sha256 committed | [2jiQyjsd…](https://testnet.nearblocks.io/txns/2jiQyjsdaPVPvn7j7cG2YmCfBEkzsm3876PEB3QxHn2U) |
| **`submit_verdicts`** | 3/3 NEAR AI Cloud TEE signatures recovered on-chain → **CRITICAL_BREACH** (2840 bps); meridian's 0.1 NEAR bond slashed into payout #1 (to Base, `Pending`: no MPC signature requested for it yet) | [**8FhCBXup…**](https://testnet.nearblocks.io/txns/8FhCBXupX4Y67QoybF3vsmQx95uPotEE9cP5iuBRx2BD) |

Notes:
- A model can be served by several TEE nodes, each with its own attested key. A second Qwen node (judge 6, `0x979121…3474`) was registered with its own attestation report ([7rsQzhfe…](https://testnet.nearblocks.io/txns/7rsQzhfeLTjPZmKNGcmAeXd6s2yvM6AMRuvUMychJiL3)) but did not vote. The script now registers a node only after an attestation report names exactly the key that signed a vote. A follow-up should group a model's node keys under one judge, so a model can never fill two quorum seats.
- The first attempt hit a NEAR AI Cloud timeout after filing the dispute. The rerun resumed the open dispute with byte-identical evidence (its hash matches the on-chain commitment), so the 10 transactions above came from that first attempt.
- **Attestation reports:** every fetch uses a fresh nonce, so each report is different bytes. On-chain `attestation_sha256` commits to the report fetched at registration. For judge 6 that exact report is saved (`Qwen_Qwen3.8-27B-979121f4.json`, sha256 matches). For judges 3–5 the registration-time reports were overwritten by a later fetch (a script bug, now fixed). The saved reports for them are fresh ones that attest the **same signing keys** registered on-chain.
- The evidence and telemetry were served from local hosts. Their bytes are in [telemetry/](telemetry/), and their sha256 matches the on-chain commitment.

This table is updated after every live run.

---

## Bonded Markets: the agent economy

The diplomatic layer that keeps treaties honest also runs competitive markets: **agents win work by posting collateral and lose it when they fail to deliver.** Nothing new is added to the protocol. Each move maps onto an existing contract method and settlement rule:

| Market move | Contract method | Outcome rule |
|---|---|---|
| Bid for a contract | `propose_treaty` with a bond (escrowed) | — |
| Win it | counterparty `ratify` | both bonds locked |
| Withdraw a losing bid | `cancel_proposal` | bond back to free (T-4) |
| Challenge a rival | `file_dispute` with hash-bound evidence | TEE judges, 2-of-3 |
| Lose | — | slash (S-1/S-2), forfeit (S-4) or refund (S-5) + trust change (S-7) |

Three rounds, run by `npm run sim` (**simulation**: contract mirror, simulated TEE keys, same wire format; votes re-checked by `npm run verify`). Each of four agents starts with 10 NEAR:

1. **The Oracle Tender:** helios (4 NEAR bond, 99.5% uptime) and vesper (2.5 NEAR, 99.0%) bid for kestrel's price-feed contract. kestrel picks helios, and vesper withdraws its losing bid. helios's feed goes stale (69% uptime on both monitors), so the ruling is **CRITICAL_BREACH** and helios's 4 NEAR bond goes to kestrel. *Real counterpart:* meridian, an oracle, was slashed the same way on testnet in [dispute #0](https://testnet.nearblocks.io/txns/CM3uVtxsuAHsuny8ePSuwHqfkXPXioNGQLjneDkMjAPu) and [dispute #1](https://testnet.nearblocks.io/txns/8FhCBXupX4Y67QoybF3vsmQx95uPotEE9cP5iuBRx2BD) (the latter judged by real NEAR AI Cloud TEE models).
2. **The Undercut:** rook signs a small treaty with vesper to gain standing, then files a false outage claim to knock it out of the market. Both monitors read 99.9%, so the ruling is **MALICIOUS_REPORT**: rook's 0.5 NEAR dispute bond goes to vesper and rook's trust drops by 150.
3. **The Rigged Monitor:** rook operates one of the two monitors and reports a fake outage against helios. The feeds disagree by more than 5% (99.7% vs 60.0%), so the ruling is **FEED_CONFLICT**: no slash, a full refund, and the treaty stays active. Manipulating the referee earns nothing.

**Play it:** the top of [`#/markets`](https://pactum-int.vercel.app/#/markets) is a playable market. You are the vault: pick one of three bonded oracle bids, then decide each epoch whether to challenge from two monitor readings. A good challenge wins the slashed bond; a bad one forfeits your 0.5 NEAR stake; a faulty monitor gets you a refund. Every outcome runs through the same settlement rules, clamp and dual-feed check as the contract (in the browser, labeled simulation, no transactions).

**Hire an agent (live, testnet):** the panel at the top of [`#/markets`](https://pactum-int.vercel.app/#/markets) is a real market, not a simulation. A small stateless backend (`api/market.js`, Vercel) runs the provider agent `house.<contract>` (function-call key only, 0.05 NEAR bond per job) and relays the judges' signed votes; whether the provider breaches is an HMAC of the treaty id under a server secret, so the evidence is deterministic and its on-chain sha256 always matches what the judges re-fetch. The two monitors are served from two different hosts (`pactum-int.vercel.app`, `pactum-monitor-b.vercel.app`), as the dual-feed check requires. *Honest limits:* both monitors are run by the same operator as the provider, so this demonstrates the protocol rather than an adversarial market; and for the live market only, the judges' prompt states the verdict thresholds (the recorded disputes above used the original prompt). End-to-end test with real transactions: `cd offchain && node src/live-test.ts --yes --target=https://pactum-int.vercel.app` → `evidence/live-market-test.json` (a breach ruled `CriticalBreach` 3/3 and the provider slashed; a false accusation ruled `MaliciousReport` 3/3 and the stake forfeited; the script also accepts deliveries, which releases both bonds via `request_exit` + `execute_exit`). Live disputes are capped at 40 per day.

**Leaderboard after three rounds:** kestrel **+4** (trust 530), vesper **+0.5** (510), rook **−0.5** (370), helios **−4** (320). On the site: [`#/markets`](https://pactum-int.vercel.app/#/markets).

**Scoring, and its honest limit:** P&L is the change in an agent's collateral (free + escrowed) plus the payouts it received, exactly as the contract settles them. The contract settles bonds, slashes, payouts and dispute bonds. Service fees written in treaty text ("pays X per epoch") are **not** transferred by the contract, so they are not counted.

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
- **Real on testnet (2026-11-13):** deployment, enclave sub-accounts, meta-tx treaty, 8 attacks refused on-chain with tx hashes (R-ROB-8 was refused by the client before reaching the chain; R-ROB-9 is covered only by the unit test and the simulation), on-chain ruling, and an MPC signature from Chain Signatures (see Live evidence).
- **Real NEAR AI Cloud judges** decided dispute #1 on testnet (see above), and decide every **Hire an agent** dispute live (disputes #2 onwards).
- **Not yet done:** a mainnet Intents deposit (needs a yes per transaction), and building and broadcasting the destination-chain transaction after the MPC signs (the payload is currently a hash of the canonical payout).

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
offchain/src/sim.ts        scripted end-to-end run + rob path (+ Bonded Markets rounds)
offchain/src/markets.ts    Bonded Markets: tender, undercut, rigged monitor, leaderboard
offchain/src/testnet.ts    the same flow with real testnet transactions (--yes required)
offchain/src/chain.ts      near-api-js client, meta-tx relayer
offchain/src/verify.ts     independent re-verification of evidence files
offchain/src/status.ts     CLI dashboard (sim or --chain)
frontend/index.html        war room (no build step)
evidence/                  sim evidence (+ testnet / attestations once run)
```
