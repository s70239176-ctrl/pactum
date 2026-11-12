// NEAR client (near-api-js 7.4.0, API per near/agent-skills `near-api-js`).
// Agents sign NEP-366 delegate actions with their function-call key; the relayer
// wraps them and pays gas (A-4). Failures are kept, not thrown, so refusals
// become evidence with a tx hash.
import { Account, JsonRpcProvider, KeyPairSigner, actions, teraToGas, type KeyPairString } from "near-api-js";

export const NETWORK = process.env.NEAR_NETWORK ?? "testnet";
// Endpoints from near/agent-skills near-api-js "RPC Endpoints" table.
export const RPC = process.env.NEAR_RPC ?? (NETWORK === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io/txns/" : "https://testnet.nearblocks.io/txns/";
export const provider = new JsonRpcProvider({ url: RPC });

export const contractId = () => {
  const c = process.env.PACTUM_CONTRACT;
  if (!c) throw new Error("set PACTUM_CONTRACT in .env");
  return c;
};

export function accountFromEnv(prefix: string): Account {
  const id = process.env[`${prefix}_ACCOUNT`], key = process.env[`${prefix}_KEY`];
  if (!id || !key) throw new Error(`set ${prefix}_ACCOUNT and ${prefix}_KEY in .env`);
  return new Account(id, provider, KeyPairSigner.fromSecretKey(key as KeyPairString));
}

export const agentAccount = (enclaveId: string, fcKey: string) => new Account(enclaveId, provider, KeyPairSigner.fromSecretKey(fcKey as KeyPairString));

export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId: contractId(), method, args })) as T;
}

export interface TxResult {
  ok: boolean;
  hash: string;
  url: string;
  value?: unknown;
  error?: string;
}

function summarize(r: { transaction?: { hash?: string }; transaction_outcome?: { id?: string }; status?: unknown; receipts_outcome?: Array<{ outcome: { status: unknown } }> }): TxResult {
  const hash = r.transaction?.hash ?? r.transaction_outcome?.id ?? "";
  const status = r.status as { SuccessValue?: string; Failure?: unknown };
  const failure = status?.Failure ?? r.receipts_outcome?.map((o) => (o.outcome.status as { Failure?: unknown }).Failure).find(Boolean);
  if (failure) return { ok: false, hash, url: EXPLORER + hash, error: JSON.stringify(failure) };
  let value: unknown;
  if (status?.SuccessValue) {
    try { value = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString()); } catch { /* non-JSON */ }
  }
  return { ok: true, hash, url: EXPLORER + hash, value };
}

/** Direct call from a full-access account (owner / relayer). */
export async function call(acct: Account, method: string, args: object, depositYocto = 0n, tgas = 100): Promise<TxResult> {
  try {
    const r = await acct.signAndSendTransaction({ receiverId: contractId(), actions: [actions.functionCall(method, args, teraToGas(String(tgas)), depositYocto)], throwOnFailure: false });
    return summarize(r as never);
  } catch (e) {
    return { ok: false, hash: "", url: "", error: (e as Error).message };
  }
}

/** Agent action: delegate signed with the enclave's function-call key, relayed (gasless). */
export async function metaCall(agent: Account, relayer: Account, method: string, args: object, depositYocto = 0n, tgas = 60): Promise<TxResult> {
  try {
    const { signedDelegate } = await agent.createSignedMetaTransaction({ receiverId: contractId(), actions: [actions.functionCall(method, args, teraToGas(String(tgas)), depositYocto)] });
    const r = await relayer.signAndSendTransaction({ receiverId: agent.accountId, actions: [actions.signedDelegate(signedDelegate)], throwOnFailure: false });
    return summarize(r as never);
  } catch (e) {
    // Signing-side refusal (e.g. local key check) still counts as a refusal, without a tx.
    return { ok: false, hash: "", url: "", error: (e as Error).message };
  }
}
