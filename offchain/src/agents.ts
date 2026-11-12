// Autonomous diplomat agents. With NEAR_AI_API_KEY set they negotiate on
// NEAR AI Cloud (private, TEE-attested inference); otherwise a scripted
// negotiation runs so the demo is reproducible.
import { NEAR_AI_BASE } from "./tee.ts";

export interface Agent {
  account: string;
  name: string;
  persona: string;
  homeChain: string;
  payoutAddress: string;
}

export interface Offer {
  from: string;
  terms: string;
  bond_near: number;
  counter_bond_near: number;
  accept: boolean;
  note: string;
}

async function llm(agent: Agent, history: Offer[], goal: string): Promise<Offer> {
  const res = await fetch(`${NEAR_AI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.NEAR_AI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.AGENT_MODEL ?? "deepseek-ai/DeepSeek-V3.1",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `You are ${agent.name} (${agent.account}), an autonomous AI agent negotiating a bonded treaty on Pactum. ${agent.persona} Goal: ${goal}. Treaty terms must be concrete and measurable (name a metric and a baseline in basis points). Reply ONLY JSON {"terms": string<=600 chars, "bond_near": number, "counter_bond_near": number, "accept": boolean, "note": string<=160}. Set accept=true only if you accept the last offer unchanged.` },
        { role: "user", content: `Negotiation so far:\n${JSON.stringify(history, null, 1)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`NEAR AI Cloud HTTP ${res.status}`);
  const j = JSON.parse((await res.json()).choices[0].message.content);
  return { from: agent.account, terms: String(j.terms).slice(0, 600), bond_near: Number(j.bond_near), counter_bond_near: Number(j.counter_bond_near), accept: !!j.accept, note: String(j.note ?? "").slice(0, 160) };
}

export interface ScriptedDeal { service: string; open: number; counter: number; settle: number; bonds: [number, number, number] }

const SCRIPT = (a: Agent, b: Agent, s: ScriptedDeal): Offer[] => {
  const t = (bps: number) => `${b.name} commits to ${s.service} for ${a.name}, at or above ${(bps / 100).toFixed(2)}% (${bps} bps) as measured by two independent monitors. ${a.name} pays 2 NEAR per epoch, settled via NEAR Intents.`;
  return [
    { from: a.account, terms: t(s.open), bond_near: 3, counter_bond_near: s.bonds[0], accept: false, note: `Opening: ${s.open / 100}% with a ${s.bonds[0]} NEAR bond, we carry the downside.` },
    { from: b.account, terms: t(s.counter), bond_near: 3, counter_bond_near: s.bonds[1], accept: false, note: `Counter: ${s.counter / 100}% is realistic, bond ${s.bonds[1]} NEAR.` },
    { from: a.account, terms: t(s.settle), bond_near: 3, counter_bond_near: s.bonds[2], accept: false, note: `Meet in the middle: ${s.settle / 100}%, ${s.bonds[2]} NEAR.` },
    { from: b.account, terms: "", bond_near: 3, counter_bond_near: s.bonds[2], accept: true, note: "Accepted." },
  ];
};

export async function negotiate(a: Agent, b: Agent, goal: string, script: ScriptedDeal, maxRounds = 6): Promise<{ final: Offer; history: Offer[]; mode: string }> {
  if (!process.env.NEAR_AI_API_KEY) {
    const h = SCRIPT(a, b, script);
    return { final: h[h.length - 2], history: h, mode: "scripted" };
  }
  const history: Offer[] = [];
  let turn = a;
  for (let i = 0; i < maxRounds; i++) {
    const o = await llm(turn, history, goal);
    history.push(o);
    if (o.accept && history.length > 1) return { final: history[history.length - 2], history, mode: "near-ai-cloud" };
    turn = turn === a ? b : a;
  }
  return { final: history[history.length - 1], history, mode: "near-ai-cloud" };
}
