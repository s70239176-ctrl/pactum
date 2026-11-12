# Pactum: architecture

> **Pactum is the on-chain diplomatic layer for autonomous AI agents.** Every agent is a sovereign enclave that locks real collateral and writes natural-language treaties. When a treaty is breached, verifiable multi-model reasoning decides the outcome, and everything settles through NEAR Intents, Chain Signatures and NEAR AI Cloud TEEs.

Status: **design. No new code until the human approves this document and RULES.md.**
Network: **testnet first.** NEAR Intents has no testnet (HACKATHON.md Q-007), so every Intents leg either runs as a `dry: true` quote or runs on mainnet with tiny amounts, and only after the human confirms each transaction.

## Addresses and endpoints (verified, not guessed)

| Thing | Value | Source |
|---|---|---|
| MPC signer (Chain Signatures), testnet | `v1.signer-prod.testnet` | near/agent-skills `near-smart-contracts/rules/chain-signatures.md` |
| MPC signer, mainnet | `v1.signer` | same file (nearblocks link) |
| MPC `sign` args | `{"request":{"path","payload_v2":{"Ecdsa"\|"Eddsa":hex},"domain_id":0\|1}}`, 1 yocto deposit, ~250 Tgas | same file |
| NEAR AI Cloud API | `https://cloud-api.near.ai/v1` (OpenAI-compatible) | `near-ai-cloud/SKILL.md` |
| Model attestation | `GET /v1/attestation/report?model=…&signing_algo=ed25519&nonce=<64 hex>` (API key) → `signing_address`, `nvidia_payload`, `intel_quote` | `near-ai-cloud/references/model-verification.md` |
| Per-response TEE signature | `GET /v1/signature/{chat_id}`; signer must equal attested `signing_address` | `near-ai-cloud/SKILL.md` |
| 1-Click Swap API | `https://1click.chaindefuser.com/v0` (OpenAPI `/docs/v0/openapi.yaml`); JWT optional, without it the fee is 0.2% (Q-006) | docs.near-intents.org/llms.txt, HACKATHON.md |
| Intents verifier contract | `intents.near` (mainnet only) | `near-intents/SKILL.md` |
| Testnet RPC | taken from docs.near.org/api/rpc/providers at implementation time | HACKATHON.md Q-009 |

Items to confirm from the docs **during implementation**, before any code depends on them: the exact bytes covered by the `/v1/signature` text field; the 1-Click asset ids we quote; and the current `near-sdk` and `near-api-js`/`near-kit` versions.

## Components

```
                          ┌───────────────────────── NEAR testnet ──────────────────────────┐
 human operator           │  pactum.<you>.testnet   (registry + escrow + court contract)    │
  (full-access key,       │    ├─ enclave registry: <agent>.pactum.<you>.testnet sub-accounts│
   never in an agent)     │    ├─ collateral ledger (NEAR now; NEP-141 stablecoins later)   │
                          │    ├─ treaties: terms, terms_hash, bonds, duration, params,     │
                          │    │            telemetry URLs, state machine                    │
                          │    ├─ disputes: evidence URI + sha256                            │
                          │    ├─ judges: TEE ed25519 signing keys + attestation hashes      │
                          │    └─ settlement: release / slash / redistribute / MPC payout    │
                          │  v1.signer-prod.testnet  (Chain Signatures MPC)                  │
                          └──────────────────────────────────────────────────────────────────┘
 agent runtimes (scripted or LLM)  ── function-call keys only, via a meta-tx relayer (gasless)
 relayer (pays gas)                ── submits SignedDelegate actions (NEP-366)
 judge panel (NEAR AI Cloud TEEs)  ── 3 models, each response signed inside the TEE
 funding leg (NEAR Intents 1-Click) ── dry quotes on testnet; tiny confirmed mainnet runs for evidence
 war room (web) + CLI              ── enclaves, treaties, escrow balances, disputes, rulings
```

## One full treaty lifecycle

```
Atlas(agent)      Relayer        Pactum contract         Meridian(agent)   Judges(NEAR AI TEE)   MPC signer     1-Click/Intents
    │                │                  │                        │                  │                 │                │
 0  │──quote 10 USDC(Base)→wNEAR (dry:true)─────────────────────────────────────────────────────────────────────────────►│  [Intents + 1-Click SDK]
    │◄─────────────── quote + deposit address ─────────────────────────────────────────────────────────────────────────────│
 1  │─SignedDelegate(register_enclave)►│                        │                  │                 │                │  [Meta tx · fn-call key]
    │                │──relay (pays gas)►│ create atlas.pactum.… │                  │                 │                │  [Sub-accounts + named accounts]
    │                │                  │ lock collateral        │                  │                 │                │
 2  │◄────────── negotiate terms off-chain (LLM via NEAR AI Cloud, or scripted) ──►│                  │                 │  [NEAR AI Cloud, private inference]
 3  │─SignedDelegate(propose_treaty: terms, bond, duration, params, telemetry)──────►│                │                 │  [Meta tx · fn-call key]
    │                │                  │ status=PROPOSED        │                  │                 │                │
 4  │                │                  │◄─SignedDelegate(ratify(terms_hash))─────│                  │                 │  [Meta tx · fn-call key]
    │                │                  │ bonds move collateral→escrow, ACTIVE    │                  │                 │
 5  │  ROB ATTEMPT: Meridian's key calls withdraw_collateral / settle / foreign method                │                │
    │                │                  │ REFUSED on-chain (escrow locked / key not allowed / not party)│              │  [Fn-call key limits]
 6  │─SignedDelegate(file_dispute(uri, sha256))──────►│ DISPUTED │                  │                 │                │  [Meta tx]
 7  │                │                  │──(off-chain) relayer reads dispute──────────────────────────►│                 │
    │                │                  │                        │ each judge: fetch evidence, check sha256,         │
    │                │                  │                        │ read 2 feeds, reason over terms; TEE signs reply  │  [NEAR AI Cloud TEE: TDX + NVIDIA CC]
 8  │                │──submit_verdicts([reply, TEE sig, judge id])►│ ed25519_verify vs attested key │                │  [TEE attestation on-chain]
    │                │                  │ quorum 2/3 · clamp · RULING             │                  │                 │
 9  │                │                  │ release / slash / redistribute bond     │                  │                 │
    │                │                  │ NEAR payout → transfer                  │                  │                 │
    │                │                  │ BTC/SOL/EVM payout → sign(path=enclave)──────────────────────────►│          │  [Chain Signatures]
    │                │                  │◄───────── signature ────────────────────────────────────────────────│          │
10  │ relayer broadcasts the signed tx on the target chain, or routes the payout through Intents ─────────────────────────►│  [Intents · 1-Click]
```

### NEAR kit per step

| # | Step | NEAR kit |
|---|---|---|
| 0 | Fund collateral from any chain | **NEAR Intents + 1-Click Swap API**. On testnet this is a `dry: true` quote. Real mainnet deposits are tiny and confirmed one by one |
| 1 | Register as an enclave | **Sub-accounts + named accounts** (`atlas.pactum.<you>.testnet`), **function-call key** added at creation, **meta transaction** so the agent needs no gas |
| 2 | Negotiate | **NEAR AI Cloud** (private inference, Intel TDX + NVIDIA confidential GPUs). Simulation mode uses scripted agents |
| 3–4 | Propose / ratify, bonds into escrow | **Function-call keys** (method allow-list + allowance) and **meta transactions** |
| 5 | Try to rob or break the treaty | **Function-call key limits** and contract guards produce real on-chain refusals (failed txs listed as evidence) |
| 6 | File dispute with hash-bound evidence | **Meta transaction** |
| 7–8 | Adjudicate | **NEAR AI Cloud TEE**: attestation `signing_address` registered on-chain; each verdict is signed inside the TEE and checked with `env::ed25519_verify` |
| 9 | Settle on NEAR | Native NEAR transfer from escrow |
| 9–10 | Settle on BTC / SOL / EVM | **Chain Signatures** (`v1.signer-prod.testnet`, derivation path per enclave); optionally routed through **NEAR Intents** |
| opt | Custody | **OutLayer / Agents-on-Intents** patterns (stretch goal) |

## Modes

| Mode | LLM calls | Chain | Purpose |
|---|---|---|---|
| `sim` | none (scripted agents, deterministic judges) | none, or local sandbox | Judges reproduce every outcome in under 3 minutes |
| `testnet` | optional (needs `NEAR_AI_API_KEY`) | NEAR testnet | Real txs, real refusals, real MPC signatures |
| `mainnet-evidence` | optional | mainnet, tiny amounts | Only Intents deposits and attestations; **each tx confirmed by the human** |

## Differences from the earlier Pactum prototype in this folder

1. Agents become **enclaves**: sub-accounts that register with the protocol and lock collateral before making treaties.
2. Judge keys move **into the TEE**: the contract verifies NEAR AI Cloud's own ed25519 response signature, not a key held by the relayer.
3. **Meta transactions + function-call keys** for every agent action, with a relayer paying gas.
4. A scripted **rob path** that produces real on-chain refusals.
5. Treaties carry **duration, parameters and telemetry URLs**, and expire automatically.
6. MPC `sign` gas raised to the documented ~250 Tgas (the old code used 50).
