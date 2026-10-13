/**
 * Edge sensitivities: how much a 1.0 (100%) move in one company moves a neighbour through
 * one cited relationship. These are the only places the model turns evidence into numbers.
 *
 *   mark_to_market  investor <- investee:  stake x cap_investee / cap_investor
 *   demand          supplier <- customer:  elasticity.up   x (annual contract / supplier revenue)
 *   supply          customer <- supplier:  elasticity.down x (annual contract / customer revenue)
 *
 * Undisclosed figures fall back to labelled assumptions (never silent defaults).
 */
import { usd } from "../lib/format";
import type { Edge, EngineNode, Mechanism, ModelParams, Step } from "./types";

/** Contract value per year, or null if not a revenue-type magnitude. */
export function annualMagnitude(e: Edge, p: ModelParams): number | null {
  if (e.magnitude_usd == null) return null;
  switch (e.magnitude_basis) {
    case "contract_total":
      return e.magnitude_usd / p.contract_years;
    case "monthly_run_rate":
      return e.magnitude_usd * 12;
    default:
      return null; // investment amounts / stake values are not revenue
  }
}

/** Share of `party`'s revenue represented by this relationship (supplier or customer side). */
function revenueShare(e: Edge, party: EngineNode, side: "supplier" | "customer", p: ModelParams): [number, string[]] {
  if (side === "supplier" && e.supplier_revenue_share != null) return [e.supplier_revenue_share, []];
  const annual = annualMagnitude(e, p);
  if (annual != null && party.revenue && party.revenue > 0) {
    const share = Math.min(p.max_exposure, annual / party.revenue);
    const note =
      e.magnitude_basis === "contract_total" ? [`${usd(e.magnitude_usd)} total spread over ${p.contract_years} years`] : [];
    return [share, note];
  }
  const why =
    annual == null
      ? `contract value undisclosed - assumed ${(p.null_magnitude_share * 100).toFixed(0)}% of ${party.name}'s revenue`
      : `${party.name}'s revenue unknown - assumed ${(p.null_magnitude_share * 100).toFixed(0)}% exposure`;
  return [p.null_magnitude_share, [why]];
}

/** Stake as a fraction of the investee: reported %, else invested amount / current value (a conservative floor). */
function stakeFraction(e: Edge, investee: EngineNode): [number | null, string[]] {
  if (e.stake_pct != null) return [e.stake_pct, []];
  if (e.magnitude_usd != null && investee.cap > 0) {
    return [
      Math.min(1, e.magnitude_usd / investee.cap),
      [`stake % undisclosed - using ${usd(e.magnitude_usd)} invested ÷ current value (a floor)`],
    ];
  }
  return [null, []];
}

/**
 * Every way a move in `from` reaches `to` through edge `e`. Returns [] when the edge does not
 * transmit in that direction (e.g. an investor's stock move does not change the investee).
 */
export function stepsVia(
  e: Edge,
  from: EngineNode,
  to: EngineNode,
  p: ModelParams,
  allowed: ReadonlySet<Mechanism>,
): Step[] {
  const out: Step[] = [];
  if (e.relation_type === "equity_stake") {
    // investor (source) holds investee (target); value flows investee -> investor
    if (allowed.has("mark_to_market") && e.target_id === from.id && e.source_id === to.id && to.cap > 0) {
      const [stake, notes] = stakeFraction(e, from);
      if (stake != null) {
        out.push({ edge: e, from: from.id, to: to.id, mechanism: "mark_to_market", weight: (stake * from.cap) / to.cap, assumptions: notes });
      }
    }
    return out;
  }
  const el = p.elasticity[e.relation_type];
  // supplies_to: source = supplier, target = customer
  if (allowed.has("demand") && e.target_id === from.id && e.source_id === to.id) {
    const [share, notes] = revenueShare(e, to, "supplier", p);
    out.push({ edge: e, from: from.id, to: to.id, mechanism: "demand", weight: el.up * share, assumptions: notes });
  }
  if (allowed.has("supply") && e.source_id === from.id && e.target_id === to.id) {
    const [share, notes] = revenueShare(e, to, "customer", p);
    out.push({ edge: e, from: from.id, to: to.id, mechanism: "supply", weight: el.down * share, assumptions: notes });
  }
  return out;
}

/** Undirected adjacency: company id -> incident edges. */
export function adjacency(edges: Edge[]): Map<string, Edge[]> {
  const m = new Map<string, Edge[]>();
  for (const e of edges) {
    for (const id of [e.source_id, e.target_id]) {
      if (!m.has(id)) m.set(id, []);
      m.get(id)!.push(e);
    }
  }
  return m;
}

export const other = (e: Edge, id: string) => (e.source_id === id ? e.target_id : e.source_id);

/**
 * Exposure lists for the company drawer: who `id` is most sensitive to, and who is most
 * sensitive to `id`, via any direct relationship (all three mechanisms).
 */
export function exposures(id: string, nodes: Map<string, EngineNode>, edges: Edge[], p: ModelParams) {
  const all = new Set<Mechanism>(["mark_to_market", "demand", "supply"]);
  const me = nodes.get(id);
  const to: Record<string, { weight: number; steps: Step[] }> = {};
  const from: Record<string, { weight: number; steps: Step[] }> = {};
  if (!me) return { exposedTo: [], exposedFrom: [] };
  for (const e of adjacency(edges).get(id) ?? []) {
    const n = nodes.get(other(e, id));
    if (!n) continue;
    for (const s of stepsVia(e, n, me, p, all)) {
      (to[n.id] ??= { weight: 0, steps: [] }).weight += s.weight;
      to[n.id].steps.push(s);
    }
    for (const s of stepsVia(e, me, n, p, all)) {
      (from[n.id] ??= { weight: 0, steps: [] }).weight += s.weight;
      from[n.id].steps.push(s);
    }
  }
  const rank = (r: typeof to) =>
    Object.entries(r)
      .map(([nid, v]) => ({ id: nid, ...v }))
      .filter((x) => x.weight > 0)
      .sort((a, b) => b.weight - a.weight);
  return { exposedTo: rank(to), exposedFrom: rank(from) };
}

/** Node `to` depends on node `from` along this edge (for upstream/downstream highlighting). */
export function dependency(e: Edge): { from: string; to: string } {
  return e.relation_type === "equity_stake"
    ? { from: e.target_id, to: e.source_id } // investor depends on investee
    : { from: e.source_id, to: e.target_id }; // customer depends on supplier
}

/** Ids within `hops` along dependency edges: upstream (what it depends on) / downstream (who depends on it). */
export function neighborhood(id: string, edges: Edge[], hops: number) {
  const up = new Map<string, number>([[id, 0]]);
  const down = new Map<string, number>([[id, 0]]);
  const walk = (seen: Map<string, number>, dir: "up" | "down") => {
    let frontier = [id];
    for (let h = 1; h <= hops; h++) {
      const next: string[] = [];
      for (const n of frontier) {
        for (const e of edges) {
          const d = dependency(e);
          const nb = dir === "up" ? (d.to === n ? d.from : null) : d.from === n ? d.to : null;
          if (nb && !seen.has(nb)) {
            seen.set(nb, h);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
  };
  walk(up, "up");
  walk(down, "down");
  up.delete(id);
  down.delete(id);
  return { up, down };
}
