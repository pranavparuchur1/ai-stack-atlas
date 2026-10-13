import { usd, pct, tone, toneClass } from "../lib/format";
import { layerVar } from "../lib/layers";
import type { Snapshot } from "../types";
import { useUi } from "../state/store";

/** Header tape of layer totals and day change. Scrolls slowly; pauses on hover/focus; static when reduced motion. */
export function TickerTape({ snap }: { snap: Snapshot }) {
  const attribution = useUi((s) => s.attribution);
  const items = [...snap.layers].reverse().map((l) => {
    const total = attribution === "primary" ? l.total_primary_usd : l.total_segment_usd;
    return (
      <span key={l.id} className="inline-flex items-center gap-2 pr-8">
        <span aria-hidden className="inline-block h-2.5 w-2.5" style={{ background: layerVar(l.id) }} />
        <span className="font-cond text-ink-2">{l.short}</span>
        <span className="num text-ink">{usd(total)}</span>
        <span className={`num ${toneClass[tone(l.day_change_pct)]}`}>{pct(l.day_change_pct)}</span>
      </span>
    );
  });
  const lead = (
    <span className="inline-flex items-center gap-2 pr-8">
      <span className="font-cond text-ink-2">AI stack</span>
      <span className="num text-ink">{usd(snap.total_market_cap_usd)}</span>
    </span>
  );
  return (
    <div className="group relative h-full overflow-hidden" aria-label="Layer totals">
      <div className="flex w-max whitespace-nowrap py-1.5 pl-4 motion-safe:animate-[tape_70s_linear_infinite] group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]">
        <div className="flex">
          {lead}
          {items}
        </div>
        {/* duplicate for a seamless loop; hidden from assistive tech */}
        <div className="flex" aria-hidden>
          {lead}
          {items}
        </div>
      </div>
    </div>
  );
}
