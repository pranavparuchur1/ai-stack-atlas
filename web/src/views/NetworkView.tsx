import { useMemo, useState } from "react";
import { NetworkGraph } from "../components/NetworkGraph";
import { FAMILY_STYLE, RELATION_FAMILY, useGraphLayout } from "../components/networkLayout";
import { useMarked } from "../data/derived";
import { neighborhood } from "../engine/channels";
import { useElementSize } from "../lib/useElementSize";
import { useUi } from "../state/store";

type Family = keyof typeof FAMILY_STYLE;

export default function NetworkView() {
  const { data: snap, companies } = useMarked();
  const { selectedId, select } = useUi();
  const [hops, setHops] = useState(2);
  const [families, setFamilies] = useState<Record<Family, boolean>>({ equity: true, compute: true, hardware: true, power: true });
  const [ref, size] = useElementSize<HTMLDivElement>();
  const height = Math.max(620, Math.min(900, (typeof window !== "undefined" ? window.innerHeight : 900) - 200));

  const edges = useMemo(
    () => (snap?.edges ?? []).filter((e) => families[RELATION_FAMILY[e.relation_type]]),
    [snap, families],
  );
  const layout = useGraphLayout(companies, snap?.edges ?? [], snap?.layers ?? [], size.width, height);
  const hood = useMemo(() => (selectedId ? neighborhood(selectedId, edges, hops) : null), [selectedId, edges, hops]);

  const decorate = useMemo(() => {
    if (!hood || !selectedId) return undefined;
    return (id: string) => {
      if (id === selectedId) return { opacity: 1, ring: true };
      if (hood.up.has(id)) return { opacity: 1, badge: `↑${hood.up.get(id)}` };
      if (hood.down.has(id)) return { opacity: 1, badge: `↓${hood.down.get(id)}`, badgeTone: "down" as const };
      return { opacity: 0.12 };
    };
  }, [hood, selectedId]);

  const edgeOpacity = useMemo(() => {
    if (!hood || !selectedId) return undefined;
    const inSet = (id: string) => id === selectedId || hood.up.has(id) || hood.down.has(id);
    return (e: { source_id: string; target_id: string }) => (inSet(e.source_id) && inSet(e.target_id) ? 1 : 0.06);
  }, [hood, selectedId]);

  return (
    <section className="px-4 pb-6 pt-4" aria-labelledby="net-title">
      <div className="mb-3 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <h1 id="net-title" className="font-cond text-[18px] font-semibold">
            Who depends on whom
          </h1>
          <p className="text-ink-2">
            {edges.length} cited relationships. Click a company to trace what it depends on (↑) and who depends on it (↓).
          </p>
        </div>
        <label className="flex items-center gap-2">
          <span className="label">Hops</span>
          <input
            type="range"
            min={1}
            max={3}
            value={hops}
            onChange={(e) => setHops(Number(e.target.value))}
            aria-label="Number of hops to highlight"
          />
          <span className="num w-3 text-ink">{hops}</span>
        </label>
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <legend className="sr-only">Relationship types</legend>
          {(Object.keys(FAMILY_STYLE) as Family[]).map((f) => (
            <label key={f} className="flex items-center gap-1.5 text-ink-2">
              <input
                type="checkbox"
                checked={families[f]}
                onChange={(e) => setFamilies((s) => ({ ...s, [f]: e.target.checked }))}
              />
              <svg width="26" height="8" aria-hidden>
                <line x1="1" x2="25" y1="4" y2="4" stroke={FAMILY_STYLE[f].stroke} strokeWidth="2" strokeDasharray={FAMILY_STYLE[f].dash} />
              </svg>
              {FAMILY_STYLE[f].label}
            </label>
          ))}
          <span className="flex items-center gap-1.5 text-ink-3">
            <svg width="26" height="8" aria-hidden>
              <line x1="1" x2="25" y1="4" y2="4" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="5 4" />
            </svg>
            estimated
          </span>
        </fieldset>
        {selectedId && (
          <button className="border border-rule px-2 py-1 font-cond text-ink-2 hover:text-ink" onClick={() => select(null)}>
            Clear selection
          </button>
        )}
      </div>
      <div ref={ref} className="border border-rule">
        {layout && snap && (
          <NetworkGraph
            layout={layout}
            edges={edges}
            layers={snap.layers}
            width={size.width}
            height={height}
            selectedId={selectedId}
            decorate={decorate}
            edgeOpacity={edgeOpacity}
            onSelect={select}
            ariaLabel="Dependency graph. Tab to a company and press Enter to select it."
          />
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        Node area ∝ market cap; lanes are layers. Line thickness ∝ log(reported $ value); thin lines = value undisclosed.
      </p>
    </section>
  );
}
