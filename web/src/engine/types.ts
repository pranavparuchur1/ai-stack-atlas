/**
 * Shock-propagation engine types. The engine is pure TypeScript with no React/DOM so the
 * simulator, the drawer's exposure lists and the backtests all share one implementation.
 */
import type { SnapshotEdge } from "../types";

export type Edge = SnapshotEdge;
export type RelationType = Edge["relation_type"];

export interface ModelParams {
  elasticity: Record<RelationType, { up: number; down: number }>;
  decay: number;
  max_hops: number;
  beta_blend: number;
  valuation_to_demand: number;
  contract_years: number;
  null_magnitude_share: number;
  max_exposure: number;
}

export interface EngineNode {
  id: string;
  name: string;
  layer: string;
  cap: number;
  revenue: number | null;
  isPublic: boolean;
}

export type ShockType = "ipo" | "valuation_change" | "earnings_beat_miss" | "supply_shock" | "demand_shock";

export interface Scenario {
  companyId: string;
  type: ShockType;
  /** ipo: valuation at listing (USD) */
  valuationUsd?: number;
  /** valuation_change / earnings: stock move; supply_shock: capacity change; demand_shock: capex change (fractions) */
  pct?: number;
}

/** How one edge transmits a shock, in the direction of travel. */
export type Mechanism = "mark_to_market" | "demand" | "supply";

export interface Step {
  edge: Edge;
  from: string;
  to: string;
  mechanism: Mechanism;
  /** sensitivity of `to` to a 1.0 move in `from` (before decay) */
  weight: number;
  /** model assumptions used to size this step (shown in the why-chain) */
  assumptions: string[];
}

export interface Contribution {
  path: Step[];
  pct: number;
  kind: Mechanism | "beta";
}

export interface Impact {
  id: string;
  layer: string;
  hop: number;
  pct: number;
  usd: number;
  graphPct: number;
  betaPct: number | null;
  contributions: Contribution[];
}

export interface PropagationResult {
  scenario: Scenario;
  source: { id: string; pct: number; usd: number; layer: string };
  impacts: Impact[];
  layerUsd: Record<string, number>;
  skipped: { edge: Edge; reason: string }[];
}

/** Betas of each company to each layer index (analytics.json). */
export type Betas = Record<string, Record<string, number | null>>;

// ------------------------------------------------------------------ backtests
export interface BacktestCompany {
  id: string;
  cap_before: number;
  /** market-adjusted returns (vs SPY) over each window, e.g. {"1": 0.034, "3": ..., "5": ...} */
  actual: Record<string, number | null>;
}

export interface BacktestEvent {
  id: string;
  name: string;
  date: string;
  description: string;
  source_url: string;
  scenario: Scenario;
  /** observed move of the shocked company itself (if listed), used as the shock size */
  companies: BacktestCompany[];
  edge_ids: string[];
  revenue: Record<string, number | null>;
}

export interface Backtests {
  generated_at: string;
  benchmark: string;
  windows: number[];
  events: BacktestEvent[];
}
