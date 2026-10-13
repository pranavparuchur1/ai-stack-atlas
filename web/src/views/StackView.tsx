import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { type KeyboardEvent, useMemo, useState } from "react";
import { Tooltip } from "../components/Tooltip";
import { layerItems, outsideStack, useMarked, type LayerItem } from "../data/derived";
import { usd, pct, tone, toneClass } from "../lib/format";
import { LAYER_NUMBER, layerFill, layerVar } from "../lib/layers";
import { useElementSize } from "../lib/useElementSize";
import { useUi } from "../state/store";
import type { LayerId, SnapshotLayer } from "../types";
import { CompanyTooltip } from "../components/CompanyTooltip";
import { StackTable } from "../components/StackTable";

const MIN_BAND = 52;
const GAP = 3;

interface Tile {
  item: LayerItem;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Band {
  layer: SnapshotLayer;
  total: number;
  change: number | null;
  y: number;
  h: number;
  tiles: Tile[];
}

/** Band thickness ~ sqrt(layer total) so a $0.8T layer is still readable next to a $14T one. */
function layout(layers: SnapshotLayer[], items: Record<LayerId, LayerItem[]>, width: number, height: number): Band[] {
  const top = [...layers].sort((a, b) => b.order - a.order); // apps at the top, power at the bottom
  const totals = top.map((l) => items[l.id as LayerId].reduce((s, i) => s + i.value, 0));
  const weights = totals.map((t) => Math.sqrt(Math.max(t, 1)));
  const free = Math.max(0, height - top.length * MIN_BAND - (top.length - 1) * GAP);
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  let y = 0;
  return top.map((layer, i) => {
    const h = Math.round(MIN_BAND + (free * weights[i]) / wsum);
    const root = hierarchy<{ children?: LayerItem[] } | LayerItem>({ children: items[layer.id as LayerId] }).sum((d) =>
      "value" in d ? (d as LayerItem).value : 0,
    );
    treemap<{ children?: LayerItem[] } | LayerItem>()
      .size([width, h])
      .paddingInner(2)
      .tile(treemapSquarify.ratio(1.4))
      .round(true)(root);
    const tiles = (root.leaves() as unknown as { data: LayerItem; x0: number; y0: number; x1: number; y1: number }[])
      .filter((n) => n.data && "company" in n.data)
      .map((n) => ({ item: n.data, x: n.x0, y: n.y0, w: n.x1 - n.x0, h: n.y1 - n.y0 }));
    // layer day change is cap-weighted over public members in the current attribution
    const pub = items[layer.id as LayerId].filter((it) => it.company.change != null);
    const prev = pub.reduce((s, it) => s + it.value / (1 + (it.company.change ?? 0)), 0);
    const cur = pub.reduce((s, it) => s + it.value, 0);
    const band = { layer, total: totals[i], change: prev > 0 ? cur / prev - 1 : null, y, h, tiles };
    y += h + GAP;
    return band;
  });
}

function TileView({ t, layer }: { t: Tile; layer: string }) {
  const { selectedId, hoveredId, select, hover } = useUi();
  const c = t.item.company;
  const selected = selectedId === c.id;
  const related = hoveredId === c.id;
  const big = t.w > 92 && t.h > 40;
  const mid = !big && t.w > 40 && t.h > 20;
  return (
    <button
      data-company={c.id}
      aria-label={big || mid ? undefined : `${c.name}, ${usd(t.item.value)}`}
      aria-pressed={selected}
      onClick={() => select(c.id)}
      onMouseEnter={() => hover(c.id)}
      onMouseLeave={() => hover(null)}
      onFocus={() => hover(c.id)}
      onBlur={() => hover(null)}
      className={`absolute overflow-hidden text-left outline-none transition-[box-shadow] focus-visible:z-10 ${
        c.tickDir === "up" ? "flash-up" : c.tickDir === "down" ? "flash-down" : ""
      }`}
      style={{
        left: t.x,
        top: t.y,
        width: t.w,
        height: t.h,
        background: layerFill(layer, selected ? "70%" : related ? "45%" : undefined),
        border: `1px ${c.is_public ? "solid" : "dashed"} color-mix(in srgb, ${layerVar(layer)} 70%, var(--ink-3))`,
        boxShadow: selected || related ? "inset 0 0 0 2px var(--ink)" : undefined,
      }}
          >
      {big && (
        <span className="flex h-full flex-col justify-between p-1.5">
          <span className="truncate font-cond text-[12px] font-medium leading-tight text-ink">
            {c.name}
            {!c.is_public && <span className="ml-1 font-normal text-ink-2">· private</span>}
          </span>
          <span className="flex items-baseline gap-1.5 text-[11px] leading-none">
            <span className="num text-ink">{usd(t.item.value)}</span>
            {c.is_public ? (
              // ink, not green/red: tile fills vary, so the sign carries direction legibly at any tint
              <span className="num text-ink-2">{pct(c.change, 1)}</span>
            ) : (
              <span className="text-ink-3">last round</span>
            )}
            {t.item.share < 1 && <span className="num text-ink-3">{Math.round(t.item.share * 100)}%</span>}
          </span>
          {t.item.share < 1 && <span className="sr-only"> segment share of market cap</span>}
        </span>
      )}
      {mid && (
        <span className="block truncate p-1 font-cond text-[11px] leading-tight text-ink">
          {c.ticker && !c.ticker.includes(".") ? c.ticker : c.name}
          <span className="sr-only">
            {" "}
            {c.name}, {usd(t.item.value)}
          </span>
        </span>
      )}
    </button>
  );
}

export function StackView() {
  const { data: snap, companies, byId, isLoading, error } = useMarked();
  const attribution = useUi((s) => s.attribution);
  const { select, selectedId, hoveredId } = useUi();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [asTable, setAsTable] = useState(false);
  const GUTTER = size.width && size.width < 900 ? 150 : 208;

  const items = useMemo(() => layerItems(companies, attribution), [companies, attribution]);
  const height = Math.max(560, (typeof window !== "undefined" ? window.innerHeight : 900) - 170);
  const bands = useMemo(
    () => (snap && size.width > GUTTER ? layout(snap.layers, items, size.width - GUTTER, height) : []),
    [snap, items, size.width, height, GUTTER],
  );
  const ordered = useMemo(() => bands.flatMap((b) => b.tiles.map((t) => t.item.company.id)), [bands]);

  if (error) return <p className="p-6 text-down">Could not load the snapshot: {String(error)}</p>;

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const uniq = [...new Set(ordered)];
    const cur = uniq.indexOf(selectedId ?? hoveredId ?? "");
    const next = uniq[(cur + (e.key === "ArrowRight" ? 1 : -1) + uniq.length) % uniq.length];
    e.preventDefault();
    select(next);
    document.querySelector<HTMLButtonElement>(`[data-company="${next}"]`)?.focus();
  };

  const stackTotal = companies.reduce((s, c) => s + c.cap, 0);
  const hovered = hoveredId ? byId.get(hoveredId) : null;

  return (
    <section aria-labelledby="stack-title" className="px-4 pb-6 pt-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div role="radiogroup" aria-label="Display" className="order-last ml-auto flex border border-rule">
          {(["Map", "Table"] as const).map((v) => (
            <button
              key={v}
              role="radio"
              aria-checked={asTable === (v === "Table")}
              onClick={() => setAsTable(v === "Table")}
              className={`px-2 py-0.5 font-cond text-[12px] ${asTable === (v === "Table") ? "bg-ink text-surface" : "text-ink-2"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <h1 id="stack-title" className="font-cond text-[18px] font-semibold text-ink">
          The AI stack, power to applications
        </h1>
        <p className="text-ink-2">
          <span className="num text-ink">{usd(stackTotal)}</span> across {companies.length} companies ·{" "}
          {attribution === "primary"
            ? "each company counted once, in its primary layer"
            : "split across layers by reported revenue segment"}
          {attribution === "segment" && (
            <>
              {" "}
              · <span className="num">{usd(outsideStack(companies))}</span> sits outside the stack (retail, ads, devices,
              launch)
            </>
          )}
        </p>
      </div>

      {asTable && snap && <StackTable items={items} layers={snap.layers} />}
      <div
        ref={ref}
        hidden={asTable}
        className="relative"
        style={{ height: isLoading ? height : bands.length ? bands[bands.length - 1].y + bands[bands.length - 1].h : height }}
        onKeyDown={onKey}
        onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
        onPointerLeave={() => setPointer(null)}
        role="group"
        aria-label="Market map. Use arrow keys to move between companies, Enter to open one."
      >
        {isLoading && <div className="absolute inset-0 animate-pulse bg-sunken" />}
        {bands.map((b) => {
          const share = stackTotal ? b.total / stackTotal : 0;
          return (
            <div key={b.layer.id} className="absolute left-0 right-0" style={{ top: b.y, height: b.h }}>
              <div
                className="absolute inset-y-0 left-0 flex flex-col justify-between border-l-[3px] py-1 pl-2.5 pr-3"
                style={{ width: GUTTER - 10, borderColor: layerVar(b.layer.id) }}
              >
                <div className="min-w-0">
                  <div className="truncate font-cond text-[13px] font-medium text-ink">
                    <span className="num mr-1.5 text-ink-3">{LAYER_NUMBER[b.layer.id as LayerId]}</span>
                    {b.layer.name}
                  </div>
                  {b.h > 64 && (
                    <div className="label mt-0.5">
                      {b.layer.company_count} companies · {b.layer.public_count} listed
                    </div>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="num text-[14px] text-ink">{usd(b.total)}</span>
                  <span className={`num text-[11px] ${toneClass[tone(b.change)]}`}>{pct(b.change)}</span>
                  <span className="num text-[11px] text-ink-3">{pct(share, 1, false)}</span>
                </div>
              </div>
              <div className="absolute inset-y-0 right-0" style={{ left: GUTTER }}>
                {b.tiles.map((t) => (
                  <TileView key={t.item.company.live ? `${t.item.key}:${t.item.company.cap}` : t.item.key} t={t} layer={b.layer.id} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-ink-3">
        Tile area ∝ market cap (USD; KRW/JPY/EUR listings FX-converted). Dashed outline = private company at its last
        priced round. Band thickness ∝ √(layer total). Click a company for its connections and evidence.
      </p>
      {hovered && pointer && (
        <Tooltip x={pointer.x} y={pointer.y}>
          <CompanyTooltip c={hovered} />
        </Tooltip>
      )}
    </section>
  );
}
