import type { Marked } from "../data/derived";
import { usd, pct, tone, toneClass } from "../lib/format";
import { layerVar } from "../lib/layers";

export function CompanyTooltip({ c }: { c: Marked }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-cond text-[13px] font-semibold text-ink">{c.name}</span>
        <span className="num text-ink-3">{c.ticker ?? "private"}</span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="num text-[15px] text-ink">{usd(c.cap)}</span>
        {c.is_public ? (
          <span className={`num ${toneClass[tone(c.change)]}`}>{pct(c.change)} today</span>
        ) : null}
      </div>
      {!c.is_public && c.valuation && (
        <div className="border-l-2 border-dashed border-rule-strong pl-2 text-ink-2">
          Private — last round valuation: {c.valuation.round}, {c.valuation.as_of_date}
          {c.valuation.age_days > 365 && <span className="text-warn"> · {Math.round(c.valuation.age_days / 30)} months old</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2" style={{ background: layerVar(c.primary_layer) }} aria-hidden />
          <span>primary: {c.primary_layer}</span>
        </span>
        {c.secondary_layers.length > 0 && <span className="text-ink-3">also {c.secondary_layers.join(", ")}</span>}
      </div>
      {c.listing_note && <div className="text-[11px] text-ink-3">{c.listing_note}</div>}
    </div>
  );
}
