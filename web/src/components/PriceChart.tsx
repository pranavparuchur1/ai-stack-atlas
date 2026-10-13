import { extent, max, min } from "d3-array";
import { scaleLinear, scaleTime } from "d3-scale";
import { area, line } from "d3-shape";
import { useMemo, useState } from "react";
import { price as fmtPrice } from "../lib/format";

interface Props {
  dates: string[];
  values: (number | null)[];
  currency: string;
  color: string;
  width: number;
  height?: number;
}

/** One-series price line with a crosshair tooltip. Title above names the series, so no legend. */
export function PriceChart({ dates, values, currency, color, width, height = 150 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(
    () => dates.map((d, i) => ({ d: new Date(d), v: values[i] })).filter((p): p is { d: Date; v: number } => p.v != null),
    [dates, values],
  );
  const m = { t: 8, r: 8, b: 18, l: 44 };
  const x = scaleTime()
    .domain(extent(pts, (p) => p.d) as [Date, Date])
    .range([m.l, width - m.r]);
  const lo = min(pts, (p) => p.v) ?? 0;
  const hi = max(pts, (p) => p.v) ?? 1;
  const y = scaleLinear().domain([lo * 0.97, hi * 1.02]).nice(4).range([height - m.b, m.t]);
  if (pts.length < 2 || width < 100) return <p className="text-ink-3">No price history (private company or new listing).</p>;
  const path = line<{ d: Date; v: number }>()
    .x((p) => x(p.d))
    .y((p) => y(p.v))(pts)!;
  const fill = area<{ d: Date; v: number }>()
    .x((p) => x(p.d))
    .y0(height - m.b)
    .y1((p) => y(p.v))(pts)!;
  const h = hover != null ? pts[hover] : null;
  const first = pts[0].v;
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`Price over the last year, from ${fmtPrice(first, currency)} to ${fmtPrice(pts.at(-1)!.v, currency)}`}
      onPointerMove={(e) => {
        const bx = e.currentTarget.getBoundingClientRect().left;
        const t = x.invert(e.clientX - bx).getTime();
        let best = 0;
        for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].d.getTime() - t) < Math.abs(pts[best].d.getTime() - t)) best = i;
        setHover(best);
      }}
      onPointerLeave={() => setHover(null)}
    >
      {y.ticks(4).map((t) => (
        <g key={t}>
          <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
          <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} className="num" fill="var(--ink-3)">
            {t >= 1000 ? `${(t / 1000).toFixed(t >= 10000 ? 0 : 1)}k` : t.toFixed(0)}
          </text>
        </g>
      ))}
      {x.ticks(4).map((t) => (
        <text key={+t} x={x(t)} y={height - 4} textAnchor="middle" fontSize={10} className="num" fill="var(--ink-3)">
          {t.toLocaleString("en-US", { month: "short", year: "2-digit" })}
        </text>
      ))}
      <path d={fill} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {h && (
        <g>
          <line x1={x(h.d)} x2={x(h.d)} y1={m.t} y2={height - m.b} stroke="var(--ink-3)" strokeDasharray="2 2" />
          <circle cx={x(h.d)} cy={y(h.v)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
          <text
            x={Math.min(x(h.d) + 6, width - 110)}
            y={m.t + 10}
            fontSize={11}
            className="num"
            fill="var(--ink)"
            paintOrder="stroke"
            stroke="var(--surface-raised)"
            strokeWidth={3}
          >
            {h.d.toISOString().slice(0, 10)} {fmtPrice(h.v, currency)}
          </text>
        </g>
      )}
    </svg>
  );
}
