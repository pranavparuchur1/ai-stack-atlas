import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../types";
import { eventNodes, replay, score, spearman } from "./backtest";
import { toNodes } from "./propagate";
import type { BacktestEvent, Backtests, ModelParams, PropagationResult } from "./types";

describe("spearman", () => {
  it("is 1 for monotone, -1 for reversed, handles ties", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 2], [5, 5, 9])).toBeCloseTo(1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });
});

describe("score", () => {
  const ev = {
    companies: [
      { id: "a", cap_before: 1, actual: { "1": 0.02 } },
      { id: "b", cap_before: 1, actual: { "1": -0.01 } },
      { id: "c", cap_before: 1, actual: { "1": null } },
    ],
  } as unknown as BacktestEvent;
  const result = {
    impacts: [
      { id: "a", pct: 0.01, hop: 1 },
      { id: "b", pct: 0.03, hop: 2 },
      { id: "c", pct: 0.05, hop: 1 },
    ],
  } as unknown as PropagationResult;

  it("scores only rows with an observed return, against a zero-move baseline", () => {
    const s = score(result, ev, "1");
    expect(s.n).toBe(2);
    expect(s.maeModel).toBeCloseTo((0.01 + 0.04) / 2);
    expect(s.maeNaive).toBeCloseTo((0.02 + 0.01) / 2);
    expect(s.hitRate).toBeCloseTo(0.5);
  });
});

describe("real backtests", () => {
  const read = <T,>(f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), "utf8")) as T;
  const bt = read<Backtests>("backtests.json");
  const snap = read<Snapshot>("snapshot_latest.json");
  const params = read<ModelParams>("model.json");
  const current = toNodes(snap.companies);

  it("uses pre-event caps and never an edge dated after the event", () => {
    for (const ev of bt.events) {
      const nodes = eventNodes(ev, current);
      const src = nodes.get(ev.scenario.company_id)!;
      expect(src.cap).toBe(ev.companies.find((c) => c.id === src.id)!.cap_before);
      const r = replay(ev, current, snap.edges, params, {});
      for (const imp of r.impacts)
        for (const c of imp.contributions) for (const s of c.path) expect(s.edge.evidence_date <= ev.date).toBe(true);
    }
  });

  it("produces a scorable set for every event", () => {
    for (const ev of bt.events) {
      const s = score(replay(ev, current, snap.edges, params, {}), ev, "3");
      expect(s.n).toBeGreaterThan(2);
      expect(s.maeModel).not.toBeNull();
    }
  });
});
