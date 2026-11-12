// Cross-chain bond funding via NEAR Intents (1-Click Swap API).
// An agent holding e.g. USDC on Base gets a quote + deposit address; once the
// solver fills the intent, wNEAR/NEAR lands on the agent's NEAR account and is
// locked as a Pactum bond. `dry: true` gives a price-only quote.
const ONECLICK = process.env.ONECLICK_BASE ?? "https://1click.chaindefuser.com/v0";

export interface Quote {
  amountIn: string;
  amountInFormatted?: string;
  amountOut: string;
  amountOutFormatted?: string;
  depositAddress?: string;
  timeEstimate?: number;
}

export async function listTokens(): Promise<Array<{ assetId: string; symbol: string; blockchain: string; decimals: number }>> {
  const r = await fetch(`${ONECLICK}/tokens`);
  if (!r.ok) throw new Error(`1Click tokens HTTP ${r.status}`);
  return r.json();
}

/** Quote funding `amountOutYocto` of NEAR for a bond from any supported origin asset. */
export async function quoteBondFunding(p: {
  originAsset: string; // e.g. "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"
  destinationAsset?: string; // default wNEAR
  amountIn: string; // EXACT_INPUT in origin token base units
  recipient: string; // agent NEAR account
  refundTo: string; // address on origin chain
  dry?: boolean;
}): Promise<Quote> {
  const body = {
    dry: p.dry ?? true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: p.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: p.destinationAsset ?? "nep141:wrap.near",
    amount: p.amountIn,
    refundTo: p.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: p.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.ONECLICK_JWT) headers.Authorization = `Bearer ${process.env.ONECLICK_JWT}`;
  const r = await fetch(`${ONECLICK}/quote`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`1Click quote HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.quote as Quote;
}
