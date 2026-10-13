import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { NetworkGraph } from "../components/NetworkGraph";
import { useGraphLayout } from "../components/networkLayout";
import { BacktestPanel } from "../components/sim/BacktestPanel";
import { Controls, type ControlsState } from "../components/sim/Controls";
import { SHOCKS } from "../components/sim/shocks";
import { ImpactTable } from "../components/sim/ImpactTable";
import { Waterfall } from "../components/sim/Waterfall";
import { useAnalytics, useModelParams } from "../data/api";
import { useMarked } from "../data/derived";
import { propagate, toNodes } from "../engine/propagate";
import type { ModelParams, Scenario } from "../engine/types";
import { pct, usd, usdDelta } from "../lib/format";
import { useElementSize } from "../lib/useElementSize";
import { storage, useUi } from "../state/store";

interface Saved extends ControlsState {
  name: string;
  savedAt: string;
}

const SAVED_KEY = "atlas.scenarios";
const loadSaved = (): Saved[] => {
  try {
    return JSON.parse(storage.get(SAVED_KEY) ?? "[]") as Saved[];
  } catch {
    return [];
  }
};

function Disclaimer() {
  return (
    <div role="note" className="border border-warn/60 bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-3 py-2 text-[12px] text-ink">
      <span className="font-semibold">Illustrative model, not a forecast or financial advice.</span>{" "}
      <span className="text-ink-2">
        Moves come from cited relationships plus labelled assumptions you can change on the left. See the backtest tab for how
        well this has matched real events (honestly: not well, except for capex shocks).
      </span>
    </div>
  );
}

export default function SimulatorView() {
  const { data: snap, companies, byId } = useMarked();
  const { data: baseParams } = useModelParams();
  const { data: analytics } = useAnalytics();
  const select = useUi((s) => s.select);
  const [search, setSearch] = useSearchParams();
  const [tab, setTab] = useState<"scenario" | "backtest">(search.get("tab") === "backtest" ? "backtest" : "scenario");
  const [override, setOverride] = useState<ModelParams | null>(null);
  const params = override ?? baseParams ?? null;
  const [state, setState] = useState<ControlsState>(() => ({
    companyId: search.get("company") ?? "anthropic",
    type: "ipo",
    pct: 0.2,
    valuationUsd: 1.5e12,
  }));
  const [saved, setSaved] = useState<Saved[]>(loadSaved);
  const [revealHop, setRevealHop] = useState(0);
  const [includeSource, setIncludeSource] = useState(false);
  const [graphRef, graphSize] = useElementSize<HTMLDivElement>();
  const [wfRef, wfSize] = useElementSize<HTMLDivElement>();

  // public companies cannot IPO: fall back to a valuation change when the URL picks one
  const src = byId.get(state.companyId);
  const effective: ControlsState = src && src.is_public && state.type === "ipo" ? { ...state, type: "valuation_change" } : state;

  const nodes = useMemo(() => toNodes(companies), [companies]);
  const scenario: Scenario = {
    companyId: effective.companyId,
    type: effective.type,
    pct: effective.type === "ipo" ? undefined : effective.pct,
    valuationUsd: effective.type === "ipo" ? effective.valuationUsd : undefined,
  };
  const scenarioKey = JSON.stringify(scenario);
  const result = useMemo(
    () => (snap && params && nodes.has(scenario.companyId) ? propagate(scenario, nodes, snap.edges, params, analytics?.beta ?? {}) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenarioKey, nodes, snap, params, analytics],
  );

  // the one deliberate motion: reveal the shock hop by hop whenever the scenario changes
  useEffect(() => {
    if (!result) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const max = Math.max(0, ...result.impacts.map((i) => i.hop));
    if (reduce) {
      const t = setTimeout(() => setRevealHop(max), 0);
      return () => clearTimeout(t);
    }
    const timers = Array.from({ length: max + 1 }, (_, h) => setTimeout(() => setRevealHop(h), 120 + h * 650));
    return () => timers.forEach(clearTimeout);
  }, [result]);

  useEffect(() => {
    const next = new URLSearchParams(search);
    next.set("company", effective.companyId);
    if (tab === "backtest") next.set("tab", "backtest");
    else next.delete("tab");
    if (next.toString() !== search.toString()) setSearch(next, { replace: true });
  }, [effective.companyId, tab, search, setSearch]);

  const layout = useGraphLayout(companies, snap?.edges ?? [], snap?.layers ?? [], graphSize.width, 520);

  if (!snap || !params) return <div className="p-6 text-ink-3">Loading model…</div>;

  const impactById = new Map(result?.impacts.map((i) => [i.id, i]) ?? []);
  const pathEdges = new Map<string, number>();
  for (const imp of result?.impacts ?? [])
    for (const c of imp.contributions) c.path.forEach((s, k) => pathEdges.set(s.edge.id, Math.min(pathEdges.get(s.edge.id) ?? 9, k + 1)));
  const pulse = result ? (revealHop === 0 ? [result.source.id] : result.impacts.filter((i) => i.hop === revealHop).map((i) => i.id)) : [];
  const layersHit = new Set(result?.impacts.map((i) => i.layer));
  const totalUsd = result ? Object.values(result.layerUsd).reduce((a, b) => a + b, 0) : 0;
  const shockLabel = SHOCKS.find((s) => s.type === effective.type)?.label;

  const save = () => {
    const name = `${src?.name ?? effective.companyId} · ${shockLabel} ${effective.type === "ipo" ? usd(effective.valuationUsd) : pct(effective.pct, 0)}`;
    const next = [{ ...effective, name, savedAt: new Date().toISOString() }, ...saved.filter((s) => s.name !== name)].slice(0, 8);
    setSaved(next);
    storage.set(SAVED_KEY, JSON.stringify(next));
  };

  return (
    <section className="px-4 pb-8 pt-4" aria-labelledby="sim-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="sim-title" className="font-cond text-[18px] font-semibold">
            Event simulator
          </h1>
          <p className="text-ink-2">Pick a company and an event; watch it travel through the cited graph.</p>
        </div>
        <div role="tablist" className="flex border border-rule">
          {(["scenario", "backtest"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 font-cond ${tab === t ? "bg-ink text-surface" : "text-ink-2 hover:text-ink"}`}
            >
              {t === "scenario" ? "Scenario" : "Backtest"}
            </button>
          ))}
        </div>
      </div>
      <Disclaimer />

      <div className="mt-4 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-[96px] lg:max-h-[calc(100vh-110px)] lg:overflow-y-auto scrollbar-thin pr-1">
          <Controls
            state={effective}
            setState={setState}
            companies={companies}
            layers={snap.layers}
            params={params}
            setParams={setOverride}
            resetParams={() => setOverride(null)}
            showScenario={tab === "scenario"}
          />
          <div className="mt-5 space-y-2 border-t border-rule pt-3">
            <div className="flex items-baseline justify-between">
              <span className="font-cond text-[14px] font-semibold">Saved scenarios</span>
              <button className="font-cond text-[12px] text-ink-2 underline" onClick={save}>
                save current
              </button>
            </div>
            {saved.length === 0 && <p className="text-[11px] text-ink-3">Saved in this browser only.</p>}
            <ul className="space-y-1">
              {saved.map((s) => (
                <li key={s.name}>
                  <button className="text-left text-ink-2 hover:text-ink hover:underline" onClick={() => setState(s)}>
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          {tab === "backtest" ? (
            <BacktestPanel nodes={nodes} edges={snap.edges} params={params} byId={byId} />
          ) : (
            result && (
              <>
                <div className="grid grid-cols-2 gap-4 border-y border-rule py-3 sm:grid-cols-4" aria-live="polite">
                  <div>
                    <div className="label">{src?.name} itself</div>
                    <div className="num text-[16px] text-ink">
                      {pct(result.source.pct, 1)} <span className="text-ink-2">{usdDelta(result.source.usd)}</span>
                    </div>
                  </div>
                  <div>
                    <div className="label">Ripple through the stack</div>
                    <div className="num text-[16px] text-ink">{usdDelta(totalUsd - result.source.usd)}</div>
                  </div>
                  <div>
                    <div className="label">Companies affected</div>
                    <div className="num text-[16px] text-ink">{result.impacts.length}</div>
                  </div>
                  <div>
                    <div className="label">Layers reached</div>
                    <div className="num text-[16px] text-ink">{layersHit.size} / 7</div>
                  </div>
                </div>
                {result.skipped.length > 0 && (
                  <p className="text-[11px] text-ink-3">
                    Not modelled: {result.skipped.map((s) => `${byId.get(s.edge.source_id)?.name} stake (${s.reason})`).join("; ")}.
                  </p>
                )}

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div ref={graphRef} className="border border-rule">
                    {layout && (
                      <NetworkGraph
                        layout={layout}
                        edges={snap.edges}
                        layers={snap.layers}
                        width={graphSize.width}
                        height={520}
                        selectedId={result.source.id}
                        onSelect={select}
                        pulse={pulse}
                        pulseKey={`${scenarioKey}-${revealHop}`}
                        ariaLabel="Shock ripple: affected companies are highlighted hop by hop"
                        decorate={(id) => {
                          if (id === result.source.id) return { ring: true, badge: pct(result.source.pct, 1), badgeTone: result.source.pct < 0 ? "down" : "up" };
                          const imp = impactById.get(id);
                          if (!imp || imp.hop > revealHop) return { opacity: 0.12 };
                          return { badge: pct(imp.pct, 2), badgeTone: imp.pct < 0 ? "down" : "up" };
                        }}
                        edgeOpacity={(e) => {
                          const h = pathEdges.get(e.id);
                          return h != null && h <= revealHop ? 1 : 0.04;
                        }}
                      />
                    )}
                  </div>
                  <div ref={wfRef}>
                    <h2 className="mb-1 font-cond text-[14px] font-semibold">Market-cap change by layer</h2>
                    <label className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-3">
                      <input type="checkbox" checked={includeSource} onChange={(e) => setIncludeSource(e.target.checked)} />
                      include {src?.name} itself · bottom-up, Power → Apps
                    </label>
                    <Waterfall
                      layers={snap.layers}
                      layerUsd={
                        includeSource
                          ? result.layerUsd
                          : { ...result.layerUsd, [result.source.layer]: (result.layerUsd[result.source.layer] ?? 0) - result.source.usd }
                      }
                      width={wfSize.width || 300}
                    />
                  </div>
                </div>

                <div>
                  <h2 className="mb-2 font-cond text-[14px] font-semibold">Who moves, by how much, and why</h2>
                  <ImpactTable result={result} names={nodes} byId={byId} revealHop={revealHop} />
                </div>
              </>
            )
          )}
        </div>
      </div>
    </section>
  );
}
