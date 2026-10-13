import { usdDelta } from "../../lib/format";
import { layerVar } from "../../lib/layers";
import type { SnapshotLayer } from "../../types";

/**
 * Layer-level $ change as a vertical waterfall: each layer's bar starts where the running total
 * ended, bottom-up from Power to Apps, ending in the total. One measure, one axis.
 */
export function Waterfall({ layers, layerUsd, width }: { layers: SnapshotLayer[]; layerUsd: Record<string, number>; width: number }) {
  const ordered = [...layers].sort((a, b) => a.order - b.order);
  const steps: { id: string; label: string; start: number; end: number; total?: boolean }[] = [];
  let run = 0;
  for (const l of ordered) {
    const v = layerUsd[l.id] ?? 0;
    steps.push({ id: l.id, label: l.short, start: run, end: run + v });
    run += v;
  }
  steps.push({ id: "total", label: "Total", start: 0, end: run, total: true });
  const lo = Math.min(0, ...steps.map((s) => Math.min(s.start, s.end)));
  const hi = Math.max(0, ...steps.map((s) => Math.max(s.start, s.end)));
  const labelW = 64;
  const valueW = 76;
  const plotW = Math.max(60, width - labelW - valueW);
  const x = (v: number) => labelW + ((v - lo) / (hi - lo || 1)) * plotW;
  const rowH = 22;
  return (
    <svg width={width} height={steps.length * rowH + 6} role="img" aria-label="Modelled market-cap change by layer">
      <line x1={x(0)} x2={x(0)} y1={0} y2={steps.length * rowH} stroke="var(--rule-strong)" />
      {steps.map((s, i) => {
        const y = i * rowH + 3;
        const a = x(Math.min(s.start, s.end));
        const w = Math.max(1, Math.abs(x(s.end) - x(s.start)));
        return (
          <g key={s.id}>
            <text x={labelW - 6} y={y + rowH / 2} dy="0.32em" textAnchor="end" fontSize={11} className="font-cond" fill="var(--ink-2)">
              {s.label}
            </text>
            <rect
              x={a}
              y={y + 3}
              width={w}
              height={rowH - 8}
              rx={2}
              fill={s.total ? "var(--ink)" : layerVar(s.id)}
              opacity={s.total ? 0.85 : 1}
            />
            {!s.total && i < steps.length - 2 && (
              <line x1={x(s.end)} x2={x(s.end)} y1={y + rowH - 5} y2={y + rowH + 3} stroke="var(--ink-3)" strokeDasharray="2 2" />
            )}
            <text x={width - 2} y={y + rowH / 2} dy="0.32em" textAnchor="end" fontSize={11} className="num" fill="var(--ink)">
              {usdDelta(s.end - s.start)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
