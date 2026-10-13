import { interpolateRgb } from "d3-interpolate";
import { scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";
import { useMemo, useState } from "react";
import { Tooltip } from "../components/Tooltip";
import { useAnalytics, useBacktests } from "../data/api";
import { useMarked } from "../data/derived";
import { num, pct } from "../lib/format";
import { layerVar } from "../lib/layers";
import { useElementSize } from "../lib/useElementSize";
import type { Analytics, SnapshotLayer } from "../types";

/** Diverging scale: blue (-1) <- neutral gray (0) -> red (+1), from the dataviz reference diverging pair. */
function useDiverging() {
  const dark =
    document.documentElement.dataset.theme === "dark" ||
    (document.documentElement.dataset.theme !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const mid = dark ? "#383835" : "#f0efec";
  const neg = dark ? "#3987e5" : "#2a78d6";
  const pos = dark ? "#e66767" : "#e34948";
  return (v: number | null) => (v == null ? "transparent" : v < 0 ? interpolateRgb(mid, neg)(-v) : interpolateRgb(mid, pos)(v));
}

function Heatmap({ a, width, layers }: { a: Analytics; width: number; layers: SnapshotLayer[] }) {
  const { byId } = useMarked();
  const color = useDiverging();
  const [hover, setHover] = useState<{ i: number; j: number; x: number; y: number } | null>(null);
  const n = a.company_ids.length;
  const label = 96;
  const cell = Math.max(5, Math.min(14, Math.floor((width - label - 8) / n)));
  const size = label + cell * n;
  // layer boundaries (company_ids are already ordered by layer, then cap)
  const bounds: { layer: string; start: number; end: number }[] = [];
  a.company_ids.forEach((id, i) => {
    const l = byId.get(id)?.primary_layer ?? "";
    if (!bounds.length || bounds.at(-1)!.layer !== l) bounds.push({ layer: l, start: i, end: i + 1 });
    else bounds.at(-1)!.end = i + 1;
  });
  return (
    <div className="relative">
      <svg width={size} height={size} role="img" aria-label="Correlation matrix of daily USD returns, companies grouped by layer">
        {bounds.map((b) => (
          <g key={b.layer}>
            <rect x={label - 6} y={label + b.start * cell} width={4} height={(b.end - b.start) * cell} fill={layerVar(b.layer)} />
            <rect y={label - 6} x={label + b.start * cell} height={4} width={(b.end - b.start) * cell} fill={layerVar(b.layer)} />
            <text x={label - 10} y={label + ((b.start + b.end) / 2) * cell} dy="0.32em" textAnchor="end" fontSize={10} className="font-cond" fill="var(--ink-2)">
              {layers.find((l) => l.id === b.layer)?.short}
            </text>
          </g>
        ))}
        <g onPointerLeave={() => setHover(null)}>
          {a.correlation.map((row, i) =>
            row.map((v, j) => (
              <rect
                key={`${i}-${j}`}
                x={label + j * cell}
                y={label + i * cell}
                width={cell - (cell > 6 ? 1 : 0)}
                height={cell - (cell > 6 ? 1 : 0)}
                fill={color(v)}
                onPointerEnter={(e) => setHover({ i, j, x: e.clientX, y: e.clientY })}
              />
            )),
          )}
        </g>
        {bounds.slice(1).map((b) => (
          <g key={`sep-${b.layer}`} stroke="var(--surface)" strokeWidth={2}>
            <line x1={label} x2={size} y1={label + b.start * cell} y2={label + b.start * cell} />
            <line y1={label} y2={size} x1={label + b.start * cell} x2={label + b.start * cell} />
          </g>
        ))}
      </svg>
      {hover && (
        <Tooltip x={hover.x} y={hover.y}>
          <span className="font-cond text-ink">
            {byId.get(a.company_ids[hover.i])?.name} × {byId.get(a.company_ids[hover.j])?.name}
          </span>
          <div className="num text-ink-2">ρ = {num(a.correlation[hover.i][hover.j], 2)}</div>
        </Tooltip>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-3">
        <span className="num">−1</span>
        <span className="h-2 w-40" style={{ background: `linear-gradient(90deg, ${color(-1)}, ${color(0)}, ${color(1)})` }} aria-hidden />
        <span className="num">+1</span>
        <span>correlation of daily USD returns, last 12 months (≥60 shared days)</span>
      </div>
    </div>
  );
}

function IndexChart({ a, width, layers }: { a: Analytics; width: number; layers: SnapshotLayer[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const h = 320;
  const m = { l: 40, r: 90, t: 10, b: 24 };
  const dates = a.layer_index.dates.map((d) => new Date(d));
  const ids = [...layers].sort((x, y) => y.order - x.order).map((l) => l.id).filter((id) => a.layer_index.levels[id]);
  const all = ids.flatMap((id) => a.layer_index.levels[id]);
  const x = scaleTime()
    .domain([dates[0], dates.at(-1)!])
    .range([m.l, width - m.r]);
  const y = scaleLinear()
    .domain([Math.min(...all, 100) * 0.97, Math.max(...all, 100) * 1.03])
    .nice()
    .range([h - m.b, m.t]);
  const path = (vals: number[]) =>
    line<number>()
      .x((_, i) => x(dates[i]))
      .y((v) => y(v))(vals) ?? "";
  // direct labels at the line ends, nudged apart so they never overlap
  const ends = ids
    .map((id) => ({ id, y: y(a.layer_index.levels[id].at(-1)!) }))
    .sort((p, q) => p.y - q.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 12);
  return (
    <svg
      width={width}
      height={h}
      role="img"
      aria-label="Cap-weighted layer indices, base 100 a year ago"
      onPointerMove={(e) => {
        const t = x.invert(e.clientX - e.currentTarget.getBoundingClientRect().left).getTime();
        let best = 0;
        dates.forEach((d, i) => {
          if (Math.abs(d.getTime() - t) < Math.abs(dates[best].getTime() - t)) best = i;
        });
        setHover(best);
      }}
      onPointerLeave={() => setHover(null)}
    >
      {y.ticks(5).map((t) => (
        <g key={t}>
          <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke={t === 100 ? "var(--rule-strong)" : "var(--rule)"} />
          <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} className="num" fill="var(--ink-3)">
            {t}
          </text>
        </g>
      ))}
      {x.ticks(6).map((t) => (
        <text key={+t} x={x(t)} y={h - 6} textAnchor="middle" fontSize={10} className="num" fill="var(--ink-3)">
          {t.toLocaleString("en-US", { month: "short", year: "2-digit" })}
        </text>
      ))}
      {ids.map((id) => (
        <path key={id} d={path(a.layer_index.levels[id])} fill="none" stroke={layerVar(id)} strokeWidth={2} />
      ))}
      {ends.map((e) => (
        <text key={e.id} x={width - m.r + 6} y={e.y} dy="0.32em" fontSize={11} className="font-cond" fill="var(--ink)">
          {layers.find((l) => l.id === e.id)?.short}{" "}
          <tspan className="num" fill="var(--ink-2)">
            {pct(a.layer_return_1y[e.id], 0)}
          </tspan>
        </text>
      ))}
      {hover != null && (
        <g>
          <line x1={x(dates[hover])} x2={x(dates[hover])} y1={m.t} y2={h - m.b} stroke="var(--ink-3)" strokeDasharray="2 2" />
          <rect x={Math.min(x(dates[hover]) + 8, width - m.r - 130)} y={m.t} width={124} height={16 + ids.length * 14} fill="var(--surface-raised)" stroke="var(--rule-strong)" />
          <text x={Math.min(x(dates[hover]) + 14, width - m.r - 124)} y={m.t + 12} fontSize={10} className="num" fill="var(--ink-2)">
            {a.layer_index.dates[hover]}
          </text>
          {ids.map((id, k) => (
            <g key={id}>
              <circle cx={x(dates[hover])} cy={y(a.layer_index.levels[id][hover])} r={3} fill={layerVar(id)} />
              <text x={Math.min(x(dates[hover]) + 14, width - m.r - 124)} y={m.t + 26 + k * 14} fontSize={10.5} className="num" fill="var(--ink)">
                <tspan fill={layerVar(id)}>■ </tspan>
                {layers.find((l) => l.id === id)?.short} {a.layer_index.levels[id][hover].toFixed(1)}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

function EventStudies({ layers }: { layers: SnapshotLayer[] }) {
  const { data: bt } = useBacktests();
  const { byId } = useMarked();
  const [win, setWin] = useState("3");
  const rows = useMemo(() => {
    if (!bt) return [];
    return bt.events.map((ev) => {
      const by: Record<string, number[]> = {};
      for (const c of ev.companies) {
        const v = c.actual[win];
        const l = byId.get(c.id)?.primary_layer;
        if (v != null && l) (by[l] ??= []).push(v);
      }
      return { ev, avg: Object.fromEntries(Object.entries(by).map(([l, v]) => [l, v.reduce((s, x) => s + x, 0) / v.length])) };
    });
  }, [bt, byId, win]);
  if (!bt) return null;
  const ls = [...layers].sort((a, b) => b.order - a.order);
  const lim = Math.max(0.01, ...rows.flatMap((r) => Object.values(r.avg).map(Math.abs)));
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <span className="label">Window</span>
        {bt.windows.map((k) => (
          <button key={k} onClick={() => setWin(String(k))} aria-pressed={win === String(k)} className={`font-cond ${win === String(k) ? "text-ink underline" : "text-ink-3"}`}>
            {k}-day
          </button>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {rows.map(({ ev, avg }) => (
          <figure key={ev.id}>
            <figcaption className="mb-1 font-cond text-[13px] text-ink">
              {ev.name} <span className="num text-ink-3">{ev.date}</span>
            </figcaption>
            <table className="w-full text-[12px]">
              <tbody>
                {ls.map((l) => {
                  const v = avg[l.id];
                  return (
                    <tr key={l.id}>
                      <td className="w-14 py-0.5 font-cond text-ink-2">{l.short}</td>
                      <td className="py-0.5">
                        <div className="relative h-3">
                          <div className="absolute left-1/2 top-0 h-3 w-px bg-rule-strong" />
                          {v != null && (
                            <div
                              className="absolute top-0.5 h-2 rounded-[2px]"
                              style={{
                                background: layerVar(l.id),
                                left: v < 0 ? `${50 - (Math.abs(v) / lim) * 50}%` : "50%",
                                width: `${(Math.abs(v) / lim) * 50}%`,
                              }}
                            />
                          )}
                        </div>
                      </td>
                      <td className="num w-16 py-0.5 text-right text-ink">{v == null ? "—" : pct(v, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </figure>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        Average market-adjusted return (vs. {bt.benchmark}) of listed companies in each layer over the window starting the session of
        the event. Equal-weighted; small samples; unrelated news included.
      </p>
    </div>
  );
}

export default function AnalyticsView() {
  const { data: a, error } = useAnalytics();
  const { data: snap } = useMarked();
  const [ref, size] = useElementSize<HTMLDivElement>();
  if (error) return <p className="p-6 text-down">{String(error)}</p>;
  if (!a || !snap) return <div className="p-6 text-ink-3">Loading…</div>;
  const ls = [...snap.layers].sort((x, y) => y.order - x.order);
  return (
    <section className="space-y-8 px-4 pb-8 pt-4" aria-labelledby="an-title">
      <div>
        <h1 id="an-title" className="font-cond text-[18px] font-semibold">
          Analytics
        </h1>
        <p className="text-ink-2">
          Window {a.window_start} → {a.as_of}. USD market-cap returns (price × FX), listed companies only.
        </p>
      </div>
      <div ref={ref} className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 className="mb-2 font-cond text-[14px] font-semibold">Layer indices (cap-weighted, base 100)</h2>
          <IndexChart a={a} width={Math.max(320, size.width >= 1200 ? size.width / 2 - 16 : size.width)} layers={snap.layers} />
          <table className="mt-4 w-full text-[12px]">
            <thead>
              <tr className="text-left">
                <th className="label py-1 font-normal">Layer</th>
                <th className="label py-1 text-right font-normal">1-year</th>
                <th className="label py-1 text-right font-normal">60-day vol</th>
                {ls.map((l) => (
                  <th key={l.id} className="label py-1 text-right font-normal">
                    ρ {l.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ls.map((l) => (
                <tr key={l.id} className="border-t border-rule">
                  <td className="py-1">
                    <span className="mr-1.5 inline-block h-2 w-2" style={{ background: layerVar(l.id) }} aria-hidden />
                    {l.short}
                  </td>
                  <td className="num py-1 text-right">{pct(a.layer_return_1y[l.id], 1)}</td>
                  <td className="num py-1 text-right">{pct(a.layer_vol_60d[l.id], 0, false)}</td>
                  {ls.map((m) => (
                    <td key={m.id} className={`num py-1 text-right ${l.id === m.id ? "text-ink-3" : ""}`}>
                      {num(a.layer_correlation[l.id]?.[m.id], 2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-ink-3">
            The Models index is SpaceX alone (its only listed member, since June 2026), so its history is short.
          </p>
        </div>
        <div>
          <h2 className="mb-2 font-cond text-[14px] font-semibold">Who moves together</h2>
          <Heatmap a={a} width={Math.max(320, size.width >= 1200 ? size.width / 2 - 16 : size.width)} layers={snap.layers} />
        </div>
      </div>
      <div>
        <h2 className="mb-2 font-cond text-[14px] font-semibold">Event studies</h2>
        <EventStudies layers={snap.layers} />
      </div>
    </section>
  );
}
