/** Plain-English "why" chains generated from the cited edges a shock travelled along. */
import type { Contribution, EngineNode, Step } from "./types";

const BUYS: Record<string, string> = {
  compute_contract: "rents compute from",
  chip_supply: "buys chips from",
  memory_supply: "buys memory from",
  foundry: "has its chips made by",
  equipment_supply: "buys equipment from",
  power_ppa: "buys power from",
  cloud_hosting: "leases data-center capacity from",
  distribution_partnership: "partners with",
  revenue_customer: "is a customer of",
};

export interface WhyPart {
  text: string;
  href?: string;
}

/** One step as a sentence fragment, oriented the way the shock travelled. */
export function describeStep(s: Step, names: Map<string, EngineNode>): WhyPart {
  const n = (id: string) => names.get(id)?.name ?? id;
  const e = s.edge;
  let text: string;
  if (s.mechanism === "mark_to_market") {
    text = `${n(s.to)} holds a stake in ${n(s.from)}`;
  } else if (s.mechanism === "demand") {
    text = `${n(s.from)} ${BUYS[e.relation_type]} ${n(s.to)}`;
  } else {
    text = `${n(s.to)} ${BUYS[e.relation_type]} ${n(s.from)}`;
  }
  return { text, href: e.evidence_url };
}

/** "Amazon ↑ — holds a stake in Anthropic [src] + Anthropic rents compute from Amazon [src]". */
export function whyChain(c: Contribution, names: Map<string, EngineNode>): WhyPart[] {
  if (c.kind === "beta") return [{ text: "co-movement with the source's layer (empirical beta)" }];
  return c.path.map((s) => describeStep(s, names));
}

export function assumptionsOf(c: Contribution): string[] {
  return [...new Set(c.path.flatMap((s) => s.assumptions))];
}
