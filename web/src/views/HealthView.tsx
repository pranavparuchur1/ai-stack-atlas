import { useMemo } from "react";
import { useHistoryIndex, useLineage } from "../data/api";
import { useMarked } from "../data/derived";
import { ago } from "../lib/format";
import { useElementSize } from "../lib/useElementSize";
import type { CheckResult, Lineage } from "../types";

const STATUS = {
  pass: { icon: "✓", label: "pass", cls: "text-up" },
  warn: { icon: "!", label: "warn", cls: "text-warn" },
  fail: { icon: "✕", label: "fail", cls: "text-down" },
} as const;

function RunStatus({ status }: { status: string }) {
  const s = status === "failed" ? STATUS.fail : status === "passed" ? STATUS.pass : STATUS.warn;
  return (
    <span className={`inline-flex items-center gap-1.5 font-cond text-[15px] ${s.cls}`}>
      <span aria-hidden className="num">{s.icon}</span>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function CheckRow({ c }: { c: CheckResult }) {
  const s = STATUS[c.status];
  return (
    <li className="grid grid-cols-[64px_1fr] gap-x-3 border-b border-rule py-1.5">
      <span className={`num ${s.cls}`}>
        <span aria-hidden>{s.icon}</span> {s.label}
      </span>
      <div>
        <div className="font-mono text-[12px] text-ink">{c.name}</div>
        <div className="text-ink-2">{c.detail}</div>
        {(c.failing ?? []).length > 0 && <div className="mt-0.5 text-[11px] text-ink-3">{(c.failing ?? []).join(" · ")}</div>}
      </div>
    </li>
  );
}

/** Lineage DAG: sources -> transforms -> checks -> outputs, one column per kind. */
function LineageGraph({ lin, width }: { lin: Lineage; width: number }) {
  const kinds = ["source", "transform", "check", "output"] as const;
  const cols = useMemo(() => kinds.map((k) => lin.nodes.filter((n) => n.kind === k)), [lin]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowH = 30;
  const h = Math.max(...cols.map((c) => c.length)) * rowH + 20;
  const colW = width / kinds.length;
  const boxW = Math.min(210, colW - 24);
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c, i) =>
    c.forEach((n, j) => pos.set(n.id, { x: i * colW + 4, y: 10 + j * rowH + ((h - 20 - c.length * rowH) / 2) })),
  );
  return (
    <svg width={width} height={h} role="img" aria-label="Data lineage from sources through transforms and checks to published files">
      <g fill="none" stroke="var(--rule-strong)">
        {lin.links.map(([a, b], i) => {
          const p = pos.get(a as string);
          const q = pos.get(b as string);
          if (!p || !q) return null;
          const x1 = p.x + boxW;
          const y1 = p.y + 11;
          const x2 = q.x;
          const y2 = q.y + 11;
          return <path key={i} d={`M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`} />;
        })}
      </g>
      {lin.nodes.map((n) => {
        const p = pos.get(n.id)!;
        return (
          <g key={n.id} transform={`translate(${p.x},${p.y})`}>
            <rect width={boxW} height={22} fill="var(--surface-raised)" stroke={n.kind === "check" ? "var(--ink-2)" : "var(--rule-strong)"} />
            <text x={6} y={11} dy="0.32em" fontSize={10.5} className="font-cond" fill="var(--ink)">
              {n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label}
            </text>
            {n.rows != null && (
              <text x={boxW - 6} y={11} dy="0.32em" fontSize={10} textAnchor="end" className="num" fill="var(--ink-3)">
                {n.rows.toLocaleString()}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function HealthView() {
  const { data: lin, error } = useLineage();
  const { data: hist } = useHistoryIndex();
  const { data: snap, companies } = useMarked();
  const [ref, size] = useElementSize<HTMLDivElement>();
  if (error) return <p className="p-6 text-down">lineage.json unavailable: {String(error)}</p>;
  if (!lin || !snap) return <div className="p-6 text-ink-3">Loading…</div>;
  const fails = lin.checks.filter((c) => c.status === "fail").length;
  const warns = lin.checks.filter((c) => c.status === "warn").length;
  const stale = companies.filter((c) => c.valuation && c.valuation.age_days > 365).length;
  const maxDur = Math.max(1, ...(lin.history ?? []).map((r) => Number(r.duration_s) || 0));

  return (
    <section className="space-y-8 px-4 pb-8 pt-4" aria-labelledby="h-title">
      <div>
        <h1 id="h-title" className="font-cond text-[18px] font-semibold">
          Pipeline health
        </h1>
        <p className="text-ink-2">
          extract (yfinance{lin.sources.some((s) => s.name.startsWith("finnhub")) ? " + Finnhub" : ""}) → DuckDB → transform →{" "}
          {lin.checks.length} data-quality checks → JSON snapshots. Scheduled every 30 min in US market hours (GitHub Actions); any
          failed check blocks publishing.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6 border-y border-rule py-4 md:grid-cols-5">
        <div>
          <div className="label">Last run</div>
          <RunStatus status={lin.status} />
          <div className="num text-[11px] text-ink-3">{lin.run_id}</div>
        </div>
        <div>
          <div className="label">Finished</div>
          <div className="num text-[15px]">{ago(lin.finished_at)}</div>
          <div className="num text-[11px] text-ink-3">{lin.duration_s.toFixed(1)} s · v{lin.pipeline_version}</div>
        </div>
        <div>
          <div className="label">Prices as of</div>
          <div className="num text-[15px]">{lin.as_of ?? "—"}</div>
          <div className="text-[11px] text-ink-3">latest close / intraday bar</div>
        </div>
        <div>
          <div className="label">Checks</div>
          <div className="num text-[15px]">
            {lin.checks.length - fails - warns} pass · <span className={warns ? "text-warn" : ""}>{warns} warn</span> ·{" "}
            <span className={fails ? "text-down" : ""}>{fails} fail</span>
          </div>
        </div>
        <div>
          <div className="label">Private valuations &gt; 1 year old</div>
          <div className={`num text-[15px] ${stale ? "text-warn" : ""}`}>{stale}</div>
          <div className="text-[11px] text-ink-3">shown with a warning in the drawer</div>
        </div>
      </div>

      <div ref={ref}>
        <h2 className="mb-2 font-cond text-[14px] font-semibold">Lineage</h2>
        {size.width > 0 && <LineageGraph lin={lin} width={size.width} />}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <h2 className="mb-1 font-cond text-[14px] font-semibold">Data-quality checks</h2>
          <ul>
            {lin.checks.map((c) => (
              <CheckRow key={c.name} c={c} />
            ))}
          </ul>
        </div>
        <div className="space-y-6">
          <div>
            <h2 className="mb-1 font-cond text-[14px] font-semibold">Warehouse row counts</h2>
            <table className="w-full text-[12px]">
              <tbody>
                {Object.entries(lin.row_counts).map(([t, n]) => (
                  <tr key={t} className="border-b border-rule">
                    <td className="py-1 font-mono text-ink-2">{t}</td>
                    <td className="num py-1 text-right">{n.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="mb-1 font-cond text-[14px] font-semibold">Sources this run</h2>
            <table className="w-full text-[12px]">
              <tbody>
                {lin.sources.map((s) => (
                  <tr key={s.name} className="border-b border-rule">
                    <td className="py-1">{s.name}</td>
                    <td className="py-1 text-ink-3">{s.detail}</td>
                    <td className="num py-1 text-right">{s.records.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="mb-1 font-cond text-[14px] font-semibold">Daily snapshots</h2>
            <p className="text-ink-2">
              {hist ? `${hist.dates.length} day${hist.dates.length === 1 ? "" : "s"} archived` : "—"}
              {hist && hist.dates.length > 0 && (
                <span className="num text-ink-3">
                  {" "}
                  ({hist.dates[0]} → {hist.dates.at(-1)})
                </span>
              )}
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
              {hist?.dates.slice(-8).reverse().map((d) => (
                <li key={d}>
                  <a className="num text-focus underline" href={`${import.meta.env.BASE_URL}data/history/${d}.json`} download>
                    {d}.json
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-1 font-cond text-[14px] font-semibold">Recent runs</h2>
            <ol className="flex h-16 items-end gap-[2px]" aria-label="Run durations, oldest to newest">
              {[...(lin.history ?? [])].reverse().map((r) => (
                <li
                  key={String(r.run_id)}
                  title={`${r.run_id}: ${r.status}, ${r.duration_s}s`}
                  className="w-2.5 rounded-t-[2px]"
                  style={{
                    height: `${Math.max(6, (Number(r.duration_s) / maxDur) * 100)}%`,
                    background: r.status === "failed" ? "var(--down)" : r.status === "passed" ? "var(--up)" : "var(--warn)",
                  }}
                />
              ))}
            </ol>
            <p className="mt-1 text-[11px] text-ink-3">bar height = run duration; colour = status (also in each bar's tooltip)</p>
          </div>
        </div>
      </div>
    </section>
  );
}
