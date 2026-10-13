import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { useMemo, useState } from "react";
import { useAnalytics, useBacktests } from "../../data/api";
import type { Marked } from "../../data/derived";
import { replay, score, summarize } from "../../engine/backtest";
import type { EngineNode, ModelParams } from "../../engine/types";
import { pct } from "../../lib/format";
import { layerVar } from "../../lib/layers";
import { useElementSize } from "../../lib/useElementSize";
import type { SnapshotEdge } from "../../types";
import { Tooltip } from "../Tooltip";

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="num text-[16px] text-ink">{value}</div>
      {note && <div className="text-[11px] text-ink-3">{note}</div>}
    </div>
  );
}

export function BacktestPanel({
  nodes,
  edges,
  params,
  byId,
}: {
  nodes: Map<string, EngineNode>;
  edges: SnapshotEdge[];
  params: ModelParams;
  byId: Map<string, Marked>;
}) {
  const { data: bt, error } = useBacktests();
  const { data: analytics } = useAnalytics();
  const [eventId, setEventId] = useState<string | null>(null);
  const [window, setWindow] = useState("1");
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ref, size] = useElementSize<HTMLDivElement>();

  const ev = bt?.events.find((e) => e.id === (eventId ?? bt.events[0]?.id));
  const scored = useMemo(() => {
    if (!ev) return null;
    return score(replay(ev, nodes, edges, params, analytics?.beta ?? {}), ev, window);
  }, [ev, nodes, edges, params, analytics, window]);
  const all = useMemo(() => {
    if (!bt) return [];
    return bt.events.flatMap((e) => score(replay(e, nodes, edges, params, analytics?.beta ?? {}), e, window).rows);
  }, [bt, nodes, edges, params, analytics, window]);

  if (error) return <p className="text-down">Backtest data unavailable: {String(error)}</p>;
  if (!bt || !ev || !scored) return <div className="h-64 animate-pulse bg-sunken" />;

  const w = size.width || 600;
  const h = 300;
  const m = { l: 48, r: 12, t: 12, b: 34 };
  const ext = extent([...scored.rows.flatMap((r) => [r.actual, r.predicted]), 0.02, -0.02]) as [number, number];
  const lim = Math.max(Math.abs(ext[0]), Math.abs(ext[1])) * 1.1;
  const xs = scaleLinear().domain([-lim, lim]).range([m.l, w - m.r]);
  const ys = scaleLinear().domain([-lim, lim]).range([h - m.b, m.t]);
  const pooled = summarize(all);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <label>
          <span className="label block">Historical event</span>
          <select className="border border-rule bg-raised px-2 py-1.5" value={ev.id} onChange={(e) => setEventId(e.target.value)}>
            {bt.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.date} · {e.name}
              </option>
            ))}
          </select>
        </label>
        <div role="radiogroup" aria-label="Return window" className="flex border border-rule">
          {bt.windows.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={window === String(k)}
              onClick={() => setWindow(String(k))}
              className={`px-2.5 py-1 font-cond ${window === String(k) ? "bg-ink text-surface" : "text-ink-2"}`}
            >
              {k}-day
            </button>
          ))}
        </div>
      </div>
      <p className="max-w-[80ch] text-ink-2">
        {ev.description}{" "}
        <a href={ev.source_url} target="_blank" rel="noreferrer" className="text-focus underline">
          source ↗
        </a>
        {ev.prior_source_url && (
          <>
            {" "}
            ·{" "}
            <a href={ev.prior_source_url} target="_blank" rel="noreferrer" className="text-focus underline">
              prior valuation ↗
            </a>
          </>
        )}
      </p>
      <div className="grid grid-cols-2 gap-4 border-y border-rule py-3 sm:grid-cols-5">
        <Metric label="Companies scored" value={String(scored.n)} note="listed, reached by the model" />
        <Metric label="Model error (MAE)" value={pct(scored.maeModel, 2, false)} />
        <Metric label="Do-nothing error" value={pct(scored.maeNaive, 2, false)} note="predict 0% for all" />
        <Metric label="Direction right" value={scored.hitRate == null ? "—" : `${Math.round(scored.hitRate * 100)}%`} />
        <Metric label="Rank correlation" value={scored.spearman == null ? "—" : scored.spearman.toFixed(2)} note="Spearman ρ" />
      </div>
      <div ref={ref} className="relative">
        <svg width={w} height={h} role="img" aria-label="Predicted versus actual market-adjusted move per company">
          <line x1={xs(-lim)} x2={xs(lim)} y1={ys(-lim)} y2={ys(lim)} stroke="var(--rule-strong)" strokeDasharray="4 3" />
          <line x1={m.l} x2={w - m.r} y1={ys(0)} y2={ys(0)} stroke="var(--rule)" />
          <line x1={xs(0)} x2={xs(0)} y1={m.t} y2={h - m.b} stroke="var(--rule)" />
          {xs.ticks(5).map((t) => (
            <text key={`x${t}`} x={xs(t)} y={h - m.b + 14} textAnchor="middle" fontSize={10} className="num" fill="var(--ink-3)">
              {(t * 100).toFixed(0)}%
            </text>
          ))}
          {ys.ticks(5).map((t) => (
            <text key={`y${t}`} x={m.l - 6} y={ys(t)} dy="0.32em" textAnchor="end" fontSize={10} className="num" fill="var(--ink-3)">
              {(t * 100).toFixed(0)}%
            </text>
          ))}
          <text x={(m.l + w - m.r) / 2} y={h - 4} textAnchor="middle" fontSize={11} className="font-cond" fill="var(--ink-2)">
            Actual move vs. SPY ({window}-day)
          </text>
          <text transform={`translate(12 ${(m.t + h - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} className="font-cond" fill="var(--ink-2)">
            Modelled move
          </text>
          {scored.rows.map((r) => {
            const c = byId.get(r.id);
            return (
              <circle
                key={r.id}
                cx={xs(r.actual)}
                cy={ys(r.predicted)}
                r={5}
                fill={layerVar(c?.primary_layer ?? "apps")}
                stroke="var(--surface)"
                strokeWidth={2}
                onPointerEnter={(e) => setHover({ id: r.id, x: e.clientX, y: e.clientY })}
                onPointerLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
        {hover && (
          <Tooltip x={hover.x} y={hover.y}>
            {(() => {
              const r = scored.rows.find((x) => x.id === hover.id)!;
              return (
                <div>
                  <div className="font-cond text-ink">{byId.get(r.id)?.name}</div>
                  <div className="num text-ink-2">
                    modelled {pct(r.predicted)} · actual {pct(r.actual)} · hop {r.hop}
                  </div>
                </div>
              );
            })()}
          </Tooltip>
        )}
      </div>
      <p className="text-[12px] text-ink-2">
        <span className="font-semibold text-ink">All {bt.events.length} events pooled ({pooled.n} company-events, {window}-day):</span>{" "}
        model MAE {pct(pooled.maeModel, 2, false)} vs. do-nothing {pct(pooled.maeNaive, 2, false)} · direction right{" "}
        {pooled.hitRate == null ? "—" : `${Math.round(pooled.hitRate * 100)}%`} · Spearman ρ {pooled.spearman?.toFixed(2) ?? "—"}.
      </p>
      <p className="text-[11px] text-ink-3">
        Points on the dashed diagonal would be perfect predictions. Replays use only relationships whose evidence is dated on or
        before the event, and market caps from the prior close; revenue and share counts are today's (a known look-ahead in the
        exposure denominators). Event windows also contain unrelated news — a small sample, so read this as a sanity check, not
        proof.
      </p>
    </div>
  );
}
