import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAnalytics, useModelParams, usePrices } from "../data/api";
import { useMarked, type Marked } from "../data/derived";
import { dependency, exposures } from "../engine/channels";
import { toNodes } from "../engine/propagate";
import { pct, price, num, tone, toneClass, usd } from "../lib/format";
import { layerVar } from "../lib/layers";
import { useElementSize } from "../lib/useElementSize";
import { useUi } from "../state/store";
import type { SnapshotEdge } from "../types";
import { PriceChart } from "./PriceChart";

const REL_LABEL: Record<SnapshotEdge["relation_type"], string> = {
  equity_stake: "equity stake",
  compute_contract: "compute contract",
  chip_supply: "chip supply",
  memory_supply: "memory supply",
  foundry: "foundry",
  equipment_supply: "equipment",
  power_ppa: "power purchase",
  cloud_hosting: "data-center lease",
  distribution_partnership: "partnership",
  revenue_customer: "customer",
};

function Kpi({ label, value, sub, className = "" }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className={`num truncate text-[15px] ${className || "text-ink"}`}>{value}</div>
      {sub && <div className="truncate text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

function Confidence({ c }: { c: SnapshotEdge["confidence"] }) {
  const style =
    c === "reported" ? "border-rule-strong text-ink-2" : c === "credible_press" ? "border-rule text-ink-2" : "border-dashed border-warn text-warn";
  return <span className={`border px-1 font-cond text-[10px] ${style}`}>{c.replace("_", " ")}</span>;
}

function EdgeRow({ e, other, onSelect }: { e: SnapshotEdge; other?: Marked; onSelect: (id: string) => void }) {
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-rule py-1.5">
      <div className="min-w-0">
        <button className="font-cond text-[13px] text-ink underline-offset-2 hover:underline" onClick={() => other && onSelect(other.id)}>
          {other?.name ?? "—"}
        </button>{" "}
        <span className="text-ink-2">{REL_LABEL[e.relation_type]}</span>
      </div>
      <div className="num text-right text-ink">{e.magnitude_usd != null ? usd(e.magnitude_usd) : <span className="text-ink-3">undisclosed</span>}</div>
      <div className="col-span-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
        <Confidence c={e.confidence} />
        <span className="num">{e.evidence_date}</span>
        {e.stake_pct != null && <span className="num">stake {pct(e.stake_pct, 1, false)}</span>}
        {e.supplier_revenue_share != null && <span className="num">{pct(e.supplier_revenue_share, 0, false)} of supplier revenue</span>}
        <a href={e.evidence_url} target="_blank" rel="noreferrer" className="text-focus underline underline-offset-2">
          source ↗
        </a>
      </div>
      <p className="col-span-2 text-[11px] leading-snug text-ink-3">{e.notes}</p>
    </li>
  );
}

export function CompanyDrawer() {
  const { selectedId, select, attribution } = useUi();
  const { data: snap, byId, companies } = useMarked();
  const { data: analytics } = useAnalytics();
  const { data: prices } = usePrices();
  const { data: params } = useModelParams();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [chartRef, chartSize] = useElementSize<HTMLDivElement>();
  const c = selectedId ? byId.get(selectedId) : undefined;

  useEffect(() => {
    if (!c) return;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c, select]);

  const edges = useMemo(() => (snap && c ? snap.edges.filter((e) => e.source_id === c.id || e.target_id === c.id) : []), [snap, c]);
  const dependsOn = edges.filter((e) => dependency(e).to === c?.id);
  const dependedBy = edges.filter((e) => dependency(e).from === c?.id);
  const exp = useMemo(
    () => (c && snap && params ? exposures(c.id, toNodes(companies), snap.edges, params) : null),
    [c, snap, params, companies],
  );

  if (!c || !snap) return null;
  // share of its primary layer, in whichever attribution mode is active
  const layerInfo = snap.layers.find((l) => l.id === c.primary_layer);
  const segShare = c.segments[c.primary_layer] ?? 0;
  const layerTotal = (attribution === "primary" ? layerInfo?.total_primary_usd : layerInfo?.total_segment_usd) ?? 0;
  const layerValue = attribution === "primary" ? c.cap : c.cap * segShare;
  const series = prices?.price[c.id];
  const corr = analytics?.corr_to_layer[c.id];
  const beta = analytics?.beta[c.id];

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="drawer-title"
      className="fixed bottom-0 right-0 top-0 z-40 flex w-[min(460px,100vw)] flex-col border-l border-rule-strong bg-raised shadow-[-12px_0_32px_rgba(0,0,0,0.25)]"
    >
      <div className="flex items-start gap-3 border-b border-rule px-4 py-3" style={{ borderTop: `3px solid ${layerVar(c.primary_layer)}` }}>
        <div className="min-w-0 flex-1">
          <h2 id="drawer-title" ref={headingRef} tabIndex={-1} className="truncate font-cond text-[18px] font-semibold outline-none">
            {c.name}
          </h2>
          <div className="text-ink-2">
            <span className="num">{c.ticker ?? "private"}</span>
            {c.exchange && ` · ${c.exchange}`} · {snap.layers.find((l) => l.id === c.primary_layer)?.name}
            {c.secondary_layers.length > 0 && <span className="text-ink-3"> · also {c.secondary_layers.join(", ")}</span>}
          </div>
        </div>
        <button onClick={() => select(null)} aria-label="Close company panel" className="px-2 text-[18px] leading-none text-ink-2 hover:text-ink">
          ×
        </button>
      </div>

      <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          <Kpi label={c.is_public ? "Market cap" : "Last round value"} value={usd(c.cap)} sub={c.live ? "live" : undefined} />
          <Kpi
            label="Today"
            value={c.is_public ? pct(c.change) : "—"}
            className={c.is_public ? toneClass[tone(c.change)] : "text-ink-3"}
            sub={c.price != null ? price(c.price, c.currency) : undefined}
          />
          <Kpi
            label="Share of layer"
            value={pct(layerTotal ? layerValue / layerTotal : null, 1, false)}
            sub={attribution === "primary" ? "primary attribution" : `by segment (${pct(segShare, 0, false)} of cap)`}
          />
          <Kpi label="Revenue (TTM)" value={usd(c.revenue_ttm_usd)} />
          <Kpi label="1-year return" value={pct(analytics?.return_1y[c.id], 1)} className={toneClass[tone(analytics?.return_1y[c.id])]} />
          <Kpi label="60-day vol (ann.)" value={pct(analytics?.vol_60d[c.id], 0, false)} />
        </div>

        {!c.is_public && c.valuation && (
          <div className="border border-dashed border-rule-strong p-3">
            <div className="font-cond text-ink">Private — last round valuation</div>
            <div className="mt-1 text-ink-2">
              {c.valuation.round}, {c.valuation.as_of_date} ({c.valuation.currency !== "USD" && `${c.valuation.currency} → USD, `}
              {c.valuation.confidence.replace("_", " ")}){" "}
              <a className="text-focus underline" href={c.valuation.source_url} target="_blank" rel="noreferrer">
                source ↗
              </a>
            </div>
            {c.valuation.age_days > 365 && (
              <div className="mt-1 text-warn">⚠ {Math.round(c.valuation.age_days / 30)} months old — likely stale</div>
            )}
          </div>
        )}

        {c.is_public && (
          <div ref={chartRef}>
            <div className="label mb-1">Price, last 12 months ({c.currency})</div>
            {prices && series ? (
              <PriceChart dates={prices.dates} values={series} currency={c.currency} color={layerVar(c.primary_layer)} width={chartSize.width} />
            ) : (
              <div className="h-[150px] animate-pulse bg-sunken" />
            )}
          </div>
        )}

        <section aria-labelledby="conn-title">
          <div className="mb-1 flex items-baseline justify-between">
            <h3 id="conn-title" className="font-cond text-[14px] font-semibold">
              Connections <span className="num font-normal text-ink-3">{edges.length}</span>
            </h3>
            <button
              className="border border-rule px-2 py-0.5 font-cond text-[12px] text-ink-2 hover:text-ink"
              onClick={() => navigate(`/simulator?company=${c.id}`)}
            >
              Simulate a shock →
            </button>
          </div>
          {edges.length === 0 && <p className="text-ink-3">No cited relationships yet. See docs/adding_a_company.md to add one.</p>}
          {dependsOn.length > 0 && (
            <>
              <div className="label mt-2">Depends on ↑ (suppliers, holdings)</div>
              <ul>
                {dependsOn.map((e) => (
                  <EdgeRow key={e.id} e={e} other={byId.get(e.source_id === c.id ? e.target_id : e.source_id)} onSelect={select} />
                ))}
              </ul>
            </>
          )}
          {dependedBy.length > 0 && (
            <>
              <div className="label mt-3">Depended on by ↓ (customers, investors)</div>
              <ul>
                {dependedBy.map((e) => (
                  <EdgeRow key={e.id} e={e} other={byId.get(e.source_id === c.id ? e.target_id : e.source_id)} onSelect={select} />
                ))}
              </ul>
            </>
          )}
        </section>

        {exp && (exp.exposedTo.length > 0 || exp.exposedFrom.length > 0) && (
          <section className="grid grid-cols-2 gap-4" aria-label="Exposure">
            {(
              [
                ["Most exposed to", exp.exposedTo],
                ["Most exposed from", exp.exposedFrom],
              ] as const
            ).map(([title, list]) => (
              <div key={title}>
                <h3 className="font-cond text-[13px] font-semibold">{title}</h3>
                <p className="mb-1 text-[11px] text-ink-3">modelled move per 10% move, direct links only</p>
                <ol className="space-y-0.5">
                  {list.slice(0, 5).map((x) => (
                    <li key={x.id} className="flex justify-between gap-2">
                      <button className="truncate text-left text-ink hover:underline" onClick={() => select(x.id)}>
                        {byId.get(x.id)?.name}
                      </button>
                      <span className="num text-ink-2">{pct(x.weight * 0.1, 2)}</span>
                    </li>
                  ))}
                  {list.length === 0 && <li className="text-ink-3">none</li>}
                </ol>
              </div>
            ))}
          </section>
        )}

        {c.is_public && corr && (
          <section aria-labelledby="corr-title">
            <h3 id="corr-title" className="font-cond text-[14px] font-semibold">
              Co-movement with layer indices
            </h3>
            <p className="mb-1 text-[11px] text-ink-3">daily USD returns, last 12 months; indices are cap-weighted, listed companies only</p>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-ink-3">
                  <th className="label py-1 font-normal">Layer</th>
                  <th className="label py-1 text-right font-normal">Correlation</th>
                  <th className="label py-1 text-right font-normal">Beta</th>
                </tr>
              </thead>
              <tbody>
                {[...snap.layers].reverse().map((l) => {
                  const r = corr[l.id];
                  return (
                    <tr key={l.id} className="border-t border-rule">
                      <td className="py-1">
                        <span className="mr-1.5 inline-block h-2 w-2" style={{ background: layerVar(l.id) }} aria-hidden />
                        {l.short}
                      </td>
                      <td className="py-1">
                        <div className="flex items-center justify-end gap-2">
                          <span className="h-1.5 bg-ink-3" style={{ width: `${Math.max(0, (r ?? 0) * 60)}px` }} aria-hidden />
                          <span className="num w-10 text-right">{num(r, 2)}</span>
                        </div>
                      </td>
                      <td className="num py-1 text-right">{num(beta?.[l.id], 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </aside>
  );
}
