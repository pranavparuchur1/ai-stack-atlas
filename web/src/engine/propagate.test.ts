import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../types";
import { annualMagnitude, exposures, neighborhood, stepsVia } from "./channels";
import { propagate, sourceSignals, toNodes } from "./propagate";
import type { Edge, EngineNode, ModelParams } from "./types";
import { assumptionsOf, whyChain } from "./why";

const P: ModelParams = {
  elasticity: Object.fromEntries(
    [
      "compute_contract",
      "chip_supply",
      "memory_supply",
      "foundry",
      "equipment_supply",
      "power_ppa",
      "cloud_hosting",
      "distribution_partnership",
      "revenue_customer",
      "equity_stake",
    ].map((r) => [r, { up: 1, down: 0.5 }]),
  ) as ModelParams["elasticity"],
  decay: 0.5,
  max_hops: 3,
  beta_blend: 0.3,
  valuation_to_demand: 0.5,
  contract_years: 5,
  null_magnitude_share: 0.02,
  max_exposure: 1,
};

const node = (id: string, layer: string, cap: number, revenue: number | null, isPublic = true): EngineNode => ({
  id,
  name: id.toUpperCase(),
  layer,
  cap,
  revenue,
  isPublic,
});

const edge = (source_id: string, target_id: string, rel: Edge["relation_type"], extra: Partial<Edge> = {}): Edge => ({
  id: `${source_id}-${target_id}-${rel}`,
  source_id,
  target_id,
  relation_type: rel,
  direction: rel === "equity_stake" ? "invests_in" : "supplies_to",
  magnitude_usd: null,
  magnitude_basis: null,
  stake_pct: null,
  supplier_revenue_share: null,
  confidence: "reported",
  evidence_url: `https://e.com/${source_id}-${target_id}`,
  evidence_date: "2026-01-01",
  notes: "test edge",
  ...extra,
});

// lab (private, $1T) <- holder (cloud, $2T) with 10% stake; holder supplies $50B/yr of compute to lab;
// chipmaker supplies holder with 20% of its revenue; fab supplies chipmaker.
const nodes = new Map(
  [
    node("lab", "models", 1000, null, false),
    node("cloud", "cloud", 2000, 100),
    node("chip", "chips", 500, 50),
    node("fab", "semicap", 300, 30),
    node("island", "apps", 10, 1),
  ].map((n) => [n.id, n]),
);
const edges = [
  edge("cloud", "lab", "equity_stake", { stake_pct: 0.1 }),
  edge("cloud", "lab", "compute_contract", { magnitude_usd: 250, magnitude_basis: "contract_total" }),
  edge("chip", "cloud", "chip_supply", { supplier_revenue_share: 0.2 }),
  edge("fab", "chip", "foundry"),
];

describe("channels", () => {
  it("annualises contract totals and monthly run-rates; ignores investments", () => {
    expect(annualMagnitude(edges[1], P)).toBe(50);
    expect(annualMagnitude(edge("a", "b", "compute_contract", { magnitude_usd: 1, magnitude_basis: "monthly_run_rate" }), P)).toBe(12);
    expect(annualMagnitude(edge("a", "b", "equity_stake", { magnitude_usd: 5, magnitude_basis: "investment_amount" }), P)).toBeNull();
  });

  it("mark-to-market = stake x investee cap / investor cap, only investee -> investor", () => {
    const all = new Set(["mark_to_market", "demand", "supply"] as const);
    const [s] = stepsVia(edges[0], nodes.get("lab")!, nodes.get("cloud")!, P, all);
    expect(s.mechanism).toBe("mark_to_market");
    expect(s.weight).toBeCloseTo((0.1 * 1000) / 2000);
    expect(stepsVia(edges[0], nodes.get("cloud")!, nodes.get("lab")!, P, all)).toEqual([]);
  });

  it("falls back to invested amount / current value when the stake % is undisclosed, and says so", () => {
    const e = edge("cloud", "lab", "equity_stake", { magnitude_usd: 50, magnitude_basis: "investment_amount" });
    const [s] = stepsVia(e, nodes.get("lab")!, nodes.get("cloud")!, P, new Set(["mark_to_market"]));
    expect(s.weight).toBeCloseTo((0.05 * 1000) / 2000);
    expect(s.assumptions[0]).toMatch(/stake % undisclosed/);
  });

  it("uses a labelled assumption for undisclosed contract values", () => {
    const [s] = stepsVia(edges[3], nodes.get("chip")!, nodes.get("fab")!, P, new Set(["demand"]));
    expect(s.weight).toBeCloseTo(1 * 0.02);
    expect(s.assumptions[0]).toMatch(/undisclosed - assumed 2%/);
  });

  it("ranks exposures in both directions", () => {
    const { exposedTo, exposedFrom } = exposures("cloud", nodes, edges, P);
    expect(exposedTo[0].id).toBe("lab"); // stake + revenue from lab
    expect(exposedFrom.map((x) => x.id)).toContain("chip");
  });

  it("finds upstream / downstream neighbourhoods by hop", () => {
    const { up, down } = neighborhood("cloud", edges, 2);
    expect([...up.entries()]).toEqual(expect.arrayContaining([["chip", 1], ["fab", 2], ["lab", 1]]));
    expect(down.has("lab")).toBe(true); // lab depends on cloud's compute
  });
});

describe("propagate", () => {
  it("computes IPO moves hop by hop with decay, matching hand calculation", () => {
    const r = propagate({ companyId: "lab", type: "ipo", valuationUsd: 1500 }, nodes, edges, P);
    expect(r.source.pct).toBeCloseTo(0.5);
    const cloud = r.impacts.find((i) => i.id === "cloud")!;
    // mark-to-market 0.1*1000/2000*0.5 = 0.025 ; demand 0.25 (=0.5*0.5) * 1 * min(1, 50/100) = 0.125
    expect(cloud.hop).toBe(1);
    expect(cloud.graphPct).toBeCloseTo(0.025 + 0.125);
    const chip = r.impacts.find((i) => i.id === "chip")!;
    // hop 2: only the demand signal travels upstream: 0.125 * 0.2 * decay 0.5
    expect(chip.hop).toBe(2);
    expect(chip.graphPct).toBeCloseTo(0.125 * 0.2 * 0.5);
    const fab = r.impacts.find((i) => i.id === "fab")!;
    expect(fab.graphPct).toBeCloseTo(0.125 * 0.2 * 0.5 * 0.02 * 0.5);
    expect(r.impacts.some((i) => i.id === "island")).toBe(false);
    // layer waterfall sums every $ change incl. the source
    const sum = Object.values(r.layerUsd).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(500 + r.impacts.reduce((s, i) => s + i.usd, 0));
  });

  it("respects max_hops and decay sliders", () => {
    const r1 = propagate({ companyId: "lab", type: "ipo", valuationUsd: 1500 }, nodes, edges, { ...P, max_hops: 1 });
    expect(r1.impacts.map((i) => i.id)).toEqual(["cloud"]);
    const r0 = propagate({ companyId: "lab", type: "ipo", valuationUsd: 1500 }, nodes, edges, { ...P, decay: 0 });
    expect(r0.impacts.find((i) => i.id === "chip")).toBeUndefined();
  });

  it("supply shocks travel downstream only", () => {
    const r = propagate({ companyId: "fab", type: "supply_shock", pct: -0.2 }, nodes, edges, P);
    expect(r.source.pct).toBe(-0.2);
    const chip = r.impacts.find((i) => i.id === "chip")!;
    expect(chip.pct).toBeLessThan(0);
    expect(r.impacts.find((i) => i.id === "lab")).toBeUndefined(); // lab is not downstream of fab via supply
  });

  it("demand shocks move suppliers but not the source", () => {
    const r = propagate({ companyId: "cloud", type: "demand_shock", pct: 0.1 }, nodes, edges, P);
    expect(r.source.pct).toBe(0);
    expect(r.impacts.find((i) => i.id === "chip")!.pct).toBeCloseTo(0.1 * 0.2);
  });

  it("blends betas into second-order moves only, for listed sources only", () => {
    const betas = { fab: { cloud: 1.0 }, chip: { models: 1.0 } };
    // listed source: cloud is 100% of the listed cloud layer
    const r = propagate({ companyId: "cloud", type: "valuation_change", pct: 0.1 }, nodes, edges, P, betas);
    const fab = r.impacts.find((i) => i.id === "fab")!;
    expect(fab.hop).toBe(2);
    expect(fab.betaPct).toBeCloseTo(0.1);
    expect(fab.pct).toBeCloseTo(0.7 * fab.graphPct + 0.3 * fab.betaPct!);
    expect(fab.contributions.at(-1)!.kind).toBe("beta"); // evidence-backed paths are listed first
    expect(r.impacts.find((i) => i.id === "chip")!.betaPct).toBeNull(); // hop 1: mechanical only
    // private source: no index the betas were fitted on -> no beta channel
    const p = propagate({ companyId: "lab", type: "ipo", valuationUsd: 1500 }, nodes, edges, P, betas);
    expect(p.impacts.every((i) => i.betaPct === null)).toBe(true);
  });

  it("generates why-chains with evidence links and surfaces assumptions", () => {
    const r = propagate({ companyId: "lab", type: "ipo", valuationUsd: 1500 }, nodes, edges, P);
    const chip = r.impacts.find((i) => i.id === "chip")!;
    const parts = whyChain(chip.contributions[0], nodes);
    expect(parts.map((p) => p.text)).toEqual(["LAB rents compute from CLOUD", "CLOUD buys chips from CHIP"]);
    expect(parts.every((p) => p.href?.startsWith("https://"))).toBe(true);
    const fab = r.impacts.find((i) => i.id === "fab")!;
    expect(assumptionsOf(fab.contributions[0]).join(" ")).toMatch(/assumed 2%/);
  });

  it("zero-size scenarios produce no impacts", () => {
    expect(sourceSignals({ companyId: "lab", type: "valuation_change" }, nodes.get("lab")!, P).move).toBe(0);
    expect(propagate({ companyId: "lab", type: "valuation_change", pct: 0 }, nodes, edges, P).impacts).toEqual([]);
  });

  it("throws on an unknown company", () => {
    expect(() => propagate({ companyId: "nope", type: "ipo" }, nodes, edges, P)).toThrow(/unknown company/);
  });
});

describe("real snapshot", () => {
  const snap = JSON.parse(readFileSync(new URL("../../public/data/snapshot_latest.json", import.meta.url), "utf8")) as Snapshot;
  const params = JSON.parse(readFileSync(new URL("../../public/data/model.json", import.meta.url), "utf8")) as ModelParams;
  const all = toNodes(snap.companies);

  it("an Anthropic IPO reaches at least 4 layers, each impact with a cited why-chain", () => {
    const anth = all.get("anthropic")!;
    const r = propagate({ companyId: "anthropic", type: "ipo", valuationUsd: anth.cap * 1.5 }, all, snap.edges, params);
    const layers = new Set(r.impacts.map((i) => i.layer));
    expect(layers.size).toBeGreaterThanOrEqual(4);
    for (const imp of r.impacts) {
      const c = imp.contributions.find((x) => x.kind !== "beta")!;
      expect(c.path.length).toBeGreaterThan(0);
      expect(c.path.every((s) => s.edge.evidence_url.startsWith("http"))).toBe(true);
    }
    const ids = r.impacts.slice(0, 8).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["amzn", "googl"]));
  });
});
