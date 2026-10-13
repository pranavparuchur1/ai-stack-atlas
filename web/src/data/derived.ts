import { useMemo } from "react";
import { useLive } from "../live/store";
import type { Attribution, LayerId, Snapshot, SnapshotCompany } from "../types";
import { LAYER_IDS } from "../types";
import { useSnapshot } from "./api";

export interface Marked extends SnapshotCompany {
  /** market cap after applying any live tick (USD) */
  cap: number;
  /** day change after applying any live tick */
  change: number | null;
  live: boolean;
  /** direction of the most recent live tick (drives the flash) */
  tickDir: "up" | "down" | null;
}

/** Companies with live ticks applied: cap = live price x shares x FX (shares/FX from the snapshot). */
export function applyLive(snap: Snapshot, live: ReturnType<typeof useLive.getState>["prices"]): Marked[] {
  return snap.companies.map((c) => {
    const t = live[c.id];
    if (!t || !c.is_public || !c.shares || !c.price) return { ...c, cap: c.market_cap_usd, change: c.day_change_pct, live: false, tickDir: null };
    // live symbols may be ADRs (e.g. SKHY = 0.1 KRX share): scale by the snapshot price ratio on first tick
    const ratio = c.live_symbol && c.live_symbol !== c.ticker ? liveRatio(c) : 1;
    const localPrice = t.price * ratio;
    const prevClose = c.day_change_pct != null ? c.price / (1 + c.day_change_pct) : null;
    return {
      ...c,
      cap: localPrice * c.shares * (c.fx_usd_per_unit ?? 1),
      change: prevClose ? localPrice / prevClose - 1 : c.day_change_pct,
      live: true,
      tickDir: t.prev == null || t.prev === t.price ? null : t.price > t.prev ? "up" : "down",
    };
  });
}

/** USD ADR price -> local listing price for SK hynix style listings (1 ADR = 0.1 share, quoted in USD). */
function liveRatio(c: SnapshotCompany): number {
  if (c.id === "skhynix") return 10 / (c.fx_usd_per_unit ?? 1);
  return 1;
}

export function useMarked() {
  const q = useSnapshot();
  const live = useLive((s) => s.prices);
  const companies = useMemo(() => (q.data ? applyLive(q.data, live) : []), [q.data, live]);
  const byId = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  return { ...q, companies, byId };
}

export interface LayerItem {
  key: string;
  company: Marked;
  layer: LayerId;
  value: number;
  share: number;
}

/** Items per layer for the chosen attribution mode (segment mode splits multi-layer companies). */
export function layerItems(companies: Marked[], mode: Attribution): Record<LayerId, LayerItem[]> {
  const out = Object.fromEntries(LAYER_IDS.map((l) => [l, [] as LayerItem[]])) as Record<LayerId, LayerItem[]>;
  for (const c of companies) {
    const shares: Record<string, number> = mode === "primary" ? { [c.primary_layer]: 1 } : c.segments;
    for (const [layer, share] of Object.entries(shares)) {
      if (!(layer in out) || share <= 0) continue; // "other" (outside the stack) is not drawn in a band
      out[layer as LayerId].push({ key: `${c.id}:${layer}`, company: c, layer: layer as LayerId, value: c.cap * share, share });
    }
  }
  for (const l of LAYER_IDS) out[l].sort((a, b) => b.value - a.value);
  return out;
}

export function outsideStack(companies: Marked[]): number {
  return companies.reduce((s, c) => s + c.cap * (c.segments.other ?? 0), 0);
}
