/**
 * Shock propagation over the cited dependency graph (see docs/methodology.md).
 *
 * 1. The scenario sets the source company's own move and the signals it emits:
 *      ipo / valuation_change / earnings  -> mark-to-market to holders + a demand signal to suppliers
 *      demand_shock (capex change)        -> demand signal only (no assumed own-price move)
 *      supply_shock (capacity change)     -> own move + a supply signal to customers
 * 2. Hop 1: direct channels (channels.ts) - mark-to-market and revenue exposure.
 * 3. Hops 2..max_hops: each reached company re-emits the signal of the mechanism that reached it,
 *    scaled by `decay` per extra hop. Mark-to-market only travels to further holders; demand only
 *    upstream; supply only downstream. Paths are simple (no revisits) and each company expands once.
 * 4. Second-order (hop >= 2) moves are blended with an empirical channel: the company's beta to
 *    the source's layer index x the source's implied move of that index.
 */
import { adjacency, other, stepsVia } from "./channels";
import type {
  Betas,
  Contribution,
  Edge,
  EngineNode,
  Impact,
  Mechanism,
  ModelParams,
  PropagationResult,
  Scenario,
} from "./types";

type Signals = Record<Mechanism, number>;

interface Frontier {
  id: string;
  signals: Signals;
  path: Contribution["path"];
}

/** Source company's own move and the signals it emits. */
export function sourceSignals(s: Scenario, src: EngineNode, p: ModelParams): { move: number; signals: Signals } {
  switch (s.type) {
    case "ipo": {
      const move = s.valuationUsd && src.cap > 0 ? s.valuationUsd / src.cap - 1 : 0;
      return { move, signals: { mark_to_market: move, demand: move * p.valuation_to_demand, supply: 0 } };
    }
    case "valuation_change":
    case "earnings_beat_miss": {
      const move = s.pct ?? 0;
      return { move, signals: { mark_to_market: move, demand: move * p.valuation_to_demand, supply: 0 } };
    }
    case "demand_shock":
      return { move: 0, signals: { mark_to_market: 0, demand: s.pct ?? 0, supply: 0 } };
    case "supply_shock": {
      const move = s.pct ?? 0;
      return { move, signals: { mark_to_market: move, demand: 0, supply: s.pct ?? 0 } };
    }
  }
}

export function propagate(
  scenario: Scenario,
  nodes: Map<string, EngineNode>,
  edges: Edge[],
  p: ModelParams,
  betas: Betas = {},
): PropagationResult {
  const src = nodes.get(scenario.companyId);
  if (!src) throw new Error(`unknown company ${scenario.companyId}`);
  const { move, signals } = sourceSignals(scenario, src, p);
  const adj = adjacency(edges);
  const impacts = new Map<string, Impact>();
  const expanded = new Set<string>([src.id]);
  let frontier: Frontier[] = [{ id: src.id, signals, path: [] }];

  for (let hop = 1; hop <= p.max_hops && frontier.length; hop++) {
    const factor = hop === 1 ? 1 : p.decay;
    const arrivals = new Map<string, Contribution[]>();
    for (const f of frontier) {
      const from = nodes.get(f.id)!;
      const allowed = new Set((Object.keys(f.signals) as Mechanism[]).filter((m) => f.signals[m] !== 0));
      if (!allowed.size) continue;
      // Several cited edges can link the same pair (e.g. a compute contract AND a distribution deal).
      // They describe one commercial relationship, so per (neighbour, mechanism) only the strongest
      // step counts - summing them would double count, especially when weak ones rest on assumptions.
      const best = new Map<string, Contribution>();
      for (const e of adj.get(f.id) ?? []) {
        const nid = other(e, f.id);
        const to = nodes.get(nid);
        if (!to || nid === src.id || f.path.some((s) => s.from === nid)) continue;
        for (const step of stepsVia(e, from, to, p, allowed)) {
          const pct = f.signals[step.mechanism] * step.weight * factor;
          if (Math.abs(pct) < 1e-7) continue;
          const key = `${nid}|${step.mechanism}`;
          const prev = best.get(key);
          if (!prev || Math.abs(pct) > Math.abs(prev.pct)) best.set(key, { path: [...f.path, step], pct, kind: step.mechanism });
        }
      }
      for (const [key, c] of best) {
        const nid = key.split("|")[0];
        if (!arrivals.has(nid)) arrivals.set(nid, []);
        arrivals.get(nid)!.push(c);
      }
    }
    const next: Frontier[] = [];
    for (const [nid, contribs] of arrivals) {
      const node = nodes.get(nid)!;
      const imp =
        impacts.get(nid) ??
        ({ id: nid, layer: node.layer, hop, pct: 0, usd: 0, graphPct: 0, betaPct: null, contributions: [] } as Impact);
      imp.contributions.push(...contribs);
      imp.graphPct += contribs.reduce((s, c) => s + c.pct, 0);
      impacts.set(nid, imp);
      if (!expanded.has(nid)) {
        expanded.add(nid);
        const sig: Signals = { mark_to_market: 0, demand: 0, supply: 0 };
        for (const c of contribs) sig[c.kind as Mechanism] += c.pct;
        const best = contribs.reduce((a, b) => (Math.abs(b.pct) > Math.abs(a.pct) ? b : a));
        next.push({ id: nid, signals: sig, path: best.path });
      }
    }
    frontier = next;
  }

  // Empirical channel for second-order moves: beta to the source's layer index x the source's implied
  // move of that index. Betas were estimated on cap-weighted indices of LISTED companies, so the channel
  // only exists for a listed source (a private round or IPO is not in the index it was fitted on).
  const layerCap = [...nodes.values()]
    .filter((n) => n.layer === src.layer && n.isPublic)
    .reduce((s, n) => s + n.cap, 0);
  const layerMove = src.isPublic && layerCap > 0 ? (move * src.cap) / layerCap : 0;
  const layerUsd: Record<string, number> = { [src.layer]: move * src.cap };
  for (const imp of impacts.values()) {
    const node = nodes.get(imp.id)!;
    const beta = betas[imp.id]?.[src.layer];
    if (imp.hop >= 2 && beta != null && node.isPublic && layerMove !== 0) {
      imp.betaPct = beta * layerMove;
      imp.pct = (1 - p.beta_blend) * imp.graphPct + p.beta_blend * imp.betaPct;
      imp.contributions.push({ path: [], pct: p.beta_blend * imp.betaPct, kind: "beta" });
    } else {
      imp.pct = imp.graphPct;
    }
    imp.usd = imp.pct * node.cap;
    // graph paths first (they carry the evidence), strongest first; the beta term is listed last
    imp.contributions.sort((a, b) => Number(a.kind === "beta") - Number(b.kind === "beta") || Math.abs(b.pct) - Math.abs(a.pct));
    layerUsd[imp.layer] = (layerUsd[imp.layer] ?? 0) + imp.usd;
  }

  const skipped = (adj.get(src.id) ?? [])
    .filter((e) => e.relation_type === "equity_stake" && e.target_id === src.id && e.stake_pct == null && e.magnitude_usd == null)
    .map((edge) => ({ edge, reason: "stake size undisclosed (contingent or unpriced) - not modelled" }));

  return {
    scenario,
    source: { id: src.id, pct: move, usd: move * src.cap, layer: src.layer },
    impacts: [...impacts.values()].sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd)),
    layerUsd,
    skipped,
  };
}

/** Build engine nodes from snapshot companies. */
export function toNodes(
  companies: { id: string; name: string; primary_layer: string; cap?: number; market_cap_usd: number; revenue_ttm_usd: number | null; is_public: boolean }[],
): Map<string, EngineNode> {
  return new Map(
    companies.map((c) => [
      c.id,
      {
        id: c.id,
        name: c.name,
        layer: c.primary_layer,
        cap: c.cap ?? c.market_cap_usd,
        revenue: c.revenue_ttm_usd,
        isPublic: c.is_public,
      },
    ]),
  );
}
