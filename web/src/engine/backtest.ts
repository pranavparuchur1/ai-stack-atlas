/**
 * Backtests: replay a historical event with only the edges known on that date and the market
 * caps from the close before it, then score predicted moves against market-adjusted returns.
 */
import { propagate } from "./propagate";
import type { BacktestEvent, Betas, Edge, EngineNode, ModelParams, PropagationResult, Scenario } from "./types";

export interface ScoredRow {
  id: string;
  predicted: number;
  actual: number;
  hop: number;
}

export interface BacktestScore {
  rows: ScoredRow[];
  n: number;
  maeModel: number | null;
  maeNaive: number | null;
  hitRate: number | null;
  spearman: number | null;
}

export function eventScenario(ev: BacktestEvent): Scenario {
  const s = ev.scenario;
  return { companyId: s.company_id, type: s.type, pct: s.pct ?? undefined, valuationUsd: s.valuation_usd ?? undefined };
}

/** Nodes as of the event: pre-event caps, current names/layers/revenue (revenue is current - documented). */
export function eventNodes(ev: BacktestEvent, current: Map<string, EngineNode>): Map<string, EngineNode> {
  const out = new Map<string, EngineNode>();
  for (const c of ev.companies) {
    const base = current.get(c.id);
    if (base) out.set(c.id, { ...base, cap: c.cap_before, revenue: ev.revenue[c.id] ?? base.revenue });
  }
  return out;
}

export function replay(ev: BacktestEvent, current: Map<string, EngineNode>, edges: Edge[], p: ModelParams, betas: Betas): PropagationResult {
  const allowed = new Set(ev.edge_ids);
  return propagate(eventScenario(ev), eventNodes(ev, current), edges.filter((e) => allowed.has(e.id)), p, betas);
}

/** Average ranks (ties share the mean rank). */
function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

export function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

/** Metrics over scored rows. Baseline: predicting zero move ("nothing happens") on the same rows. */
export function summarize(rows: ScoredRow[]): BacktestScore {
  const n = rows.length;
  if (!n) return { rows, n, maeModel: null, maeNaive: null, hitRate: null, spearman: null };
  const mae = (f: (r: ScoredRow) => number) => rows.reduce((s, r) => s + Math.abs(f(r) - r.actual), 0) / n;
  const signed = rows.filter((r) => Math.abs(r.predicted) > 1e-3 && Math.abs(r.actual) > 1e-9);
  return {
    rows,
    n,
    maeModel: mae((r) => r.predicted),
    maeNaive: mae(() => 0),
    hitRate: signed.length ? signed.filter((r) => Math.sign(r.predicted) === Math.sign(r.actual)).length / signed.length : null,
    spearman: spearman(
      rows.map((r) => r.predicted),
      rows.map((r) => r.actual),
    ),
  };
}

/** Score the companies the model moved that are listed and have an observed return in `window`. */
export function score(result: PropagationResult, ev: BacktestEvent, window: string): BacktestScore {
  const actual = new Map(ev.companies.map((c) => [c.id, c.actual[window]]));
  const rows: ScoredRow[] = [];
  for (const imp of result.impacts) {
    const a = actual.get(imp.id);
    if (a != null) rows.push({ id: imp.id, predicted: imp.pct, actual: a, hop: imp.hop });
  }
  return summarize(rows);
}
