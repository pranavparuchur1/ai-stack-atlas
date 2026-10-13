import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from "d3-sankey";
import { useMemo, useState } from "react";
import { Tooltip } from "../components/Tooltip";
import { useModelParams } from "../data/api";
import { useMarked, type Marked } from "../data/derived";
import { annualMagnitude } from "../engine/channels";
import type { ModelParams } from "../engine/types";
import { usd } from "../lib/format";
import { layerFill, layerVar } from "../lib/layers";
import { useElementSize } from "../lib/useElementSize";
import type { SnapshotEdge, SnapshotLayer } from "../types";

interface N {
  id: string;
  name: string;
  /** stack layer id (not `layer`: d3-sankey writes its own column index there) */
  lid: string;
}
interface L {
  source: string;
  target: string;
  value: number;
  edges: SnapshotEdge[];
}

type SN = SankeyNode<N, L>;
type SL = SankeyLink<N, L>;

/**
 * Money flows from the paying customer to the supplier: a supplies_to edge (A supplies B) is a
 * flow B -> A. Only disclosed, revenue-type magnitudes are drawn, annualised per model.json.
 * Flows that run "up" the stack (a lower layer paying a higher one) cannot be drawn left-to-right
 * and are listed separately.
 */
function buildFlows(edges: SnapshotEdge[], byId: Map<string, Marked>, layers: SnapshotLayer[], p: ModelParams) {
  const order = new Map(layers.map((l) => [l.id, l.order]));
  const down: L[] = [];
  const up: { payer: string; payee: string; value: number; edge: SnapshotEdge }[] = [];
  const unquantified: SnapshotEdge[] = [];
  for (const e of edges) {
    if (e.relation_type === "equity_stake") continue;
    const payer = byId.get(e.target_id);
    const payee = byId.get(e.source_id);
    if (!payer || !payee) continue;
    const annual = annualMagnitude(e, p);
    if (annual == null) {
      unquantified.push(e);
      continue;
    }
    if ((order.get(payer.primary_layer) ?? 0) > (order.get(payee.primary_layer) ?? 0)) {
      down.push({ source: payer.id, target: payee.id, value: annual, edges: [e] });
    } else {
      up.push({ payer: payer.id, payee: payee.id, value: annual, edge: e });
    }
  }
  return { down, up, unquantified };
}

export default function FlowView() {
  const { data: snap, byId } = useMarked();
  const { data: params } = useModelParams();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ l: SL; x: number; y: number } | null>(null);
  const height = 620;

  const flows = useMemo(
    () => (snap && params ? buildFlows(snap.edges, byId, snap.layers, params) : null),
    [snap, params, byId],
  );

  const graph = useMemo(() => {
    if (!flows || !snap || size.width < 200) return null;
    const ids = new Set(flows.down.flatMap((l) => [l.source, l.target]));
    const nodes: N[] = [...ids].map((id) => ({ id, name: byId.get(id)!.name, lid: byId.get(id)!.primary_layer }));
    const order = new Map(snap.layers.map((l) => [l.id, l.order]));
    const maxOrder = Math.max(...snap.layers.map((l) => l.order));
    const gen = sankey<N, L>()
      .nodeId((d) => d.id)
      .nodeWidth(10)
      .nodePadding(9)
      .extent([
        [1, 18],
        [size.width - 150, height - 6],
      ]);
    const g = gen({ nodes: nodes.map((d) => ({ ...d })), links: flows.down.map((d) => ({ ...d })) });
    // d3-sankey picks columns from graph depth; pin every company to its stack layer's column instead
    // (Apps on the left ... Power on the right) so the columns line up with the headers.
    const colW = (size.width - 150 - 10) / (maxOrder - 1);
    for (const n of g.nodes) {
      n.x0 = 1 + (maxOrder - (order.get(n.lid) ?? 1)) * colW;
      n.x1 = n.x0 + 10;
    }
    return g;
  }, [flows, snap, size.width, byId]);

  if (!snap || !flows) return <div className="p-6 text-ink-3">Loading…</div>;
  const total = flows.down.reduce((s, l) => s + l.value, 0);
  const columns = [...snap.layers].sort((a, b) => b.order - a.order);

  return (
    <section className="px-4 pb-8 pt-4" aria-labelledby="flow-title">
      <h1 id="flow-title" className="font-cond text-[18px] font-semibold">
        How AI spending flows down the stack
      </h1>
      <p className="max-w-[90ch] text-ink-2">
        Disclosed contracts only, annualised (<span className="num">{usd(total)}</span>/yr drawn across {flows.down.length}{" "}
        contracts). Multi-year totals are spread over {params?.contract_years} years and monthly run-rates ×12 — a modelling
        choice, not reported annual figures. {flows.unquantified.length} relationships have no disclosed value and are not drawn.
      </p>
      <div ref={ref} className="relative mt-3">
        <div className="relative h-4 font-cond text-[11px]">
          {columns.map((l, i) => (
            <span
              key={l.id}
              className="absolute text-ink-2"
              style={{ left: 1 + (i * (size.width - 160)) / (columns.length - 1) }}
            >
              <span className="mr-1 inline-block h-2 w-2" style={{ background: layerVar(l.id) }} aria-hidden />
              {l.short}
            </span>
          ))}
        </div>
        {graph && (
          <svg width={size.width} height={height} role="img" aria-label="Sankey diagram of annualised disclosed contract flows between companies">
            <g fill="none">
              {graph.links.map((l, i) => {
                const s = l.source as SN;
                return (
                  <path
                    key={i}
                    d={sankeyLinkHorizontal()(l) ?? undefined}
                    stroke={layerVar(s.lid)}
                    strokeOpacity={hover?.l === l ? 0.75 : 0.35}
                    strokeWidth={Math.max(1, l.width ?? 1)}
                    onPointerEnter={(e) => setHover({ l, x: e.clientX, y: e.clientY })}
                    onPointerMove={(e) => setHover({ l, x: e.clientX, y: e.clientY })}
                    onPointerLeave={() => setHover(null)}
                  />
                );
              })}
            </g>
            {graph.nodes.map((n) => (
              <g key={n.id}>
                <rect
                  x={n.x0}
                  y={n.y0}
                  width={(n.x1 ?? 0) - (n.x0 ?? 0)}
                  height={Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0))}
                  fill={layerFill(n.lid, "85%")}
                  stroke={layerVar(n.lid)}
                />
                <text
                  x={(n.x1 ?? 0) + 5}
                  y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
                  dy="0.32em"
                  fontSize={11}
                  className="font-cond"
                  fill="var(--ink)"
                  paintOrder="stroke"
                  stroke="var(--surface)"
                  strokeWidth={3}
                >
                  {n.name} <tspan className="num" fill="var(--ink-3)">{usd(n.value)}</tspan>
                </text>
              </g>
            ))}
          </svg>
        )}
        {hover && (
          <Tooltip x={hover.x} y={hover.y}>
            <div className="font-cond text-ink">
              {(hover.l.source as SN).name} pays {(hover.l.target as SN).name}
            </div>
            <div className="num text-ink-2">≈ {usd(hover.l.value)}/yr</div>
            {hover.l.edges.map((e) => (
              <div key={e.id} className="text-[11px] text-ink-3">
                {e.relation_type.replace(/_/g, " ")}: {usd(e.magnitude_usd)} ({e.magnitude_basis?.replace(/_/g, " ")}) ·{" "}
                {e.confidence.replace("_", " ")}
              </div>
            ))}
          </Tooltip>
        )}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="font-cond text-[14px] font-semibold">Flows up the stack</h2>
          <p className="mb-2 text-[11px] text-ink-3">a lower layer paying a higher one — real, but not drawable left-to-right</p>
          <table className="w-full text-[12px]">
            <tbody>
              {flows.up.map((f) => (
                <tr key={f.edge.id} className="border-b border-rule">
                  <td className="py-1">
                    {byId.get(f.payer)?.name} → {byId.get(f.payee)?.name}
                  </td>
                  <td className="py-1 text-ink-3">{f.edge.relation_type.replace(/_/g, " ")}</td>
                  <td className="num py-1 text-right">{usd(f.value)}/yr</td>
                  <td className="py-1 pl-2">
                    <a className="text-focus" href={f.edge.evidence_url} target="_blank" rel="noreferrer" aria-label="source">
                      ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="font-cond text-[14px] font-semibold">Relationships without a disclosed value</h2>
          <p className="mb-2 text-[11px] text-ink-3">counted by paying layer → supplying layer; not drawn above</p>
          <UnquantifiedMatrix edges={flows.unquantified} byId={byId} layers={snap.layers} />
        </div>
      </div>
    </section>
  );
}

function UnquantifiedMatrix({ edges, byId, layers }: { edges: SnapshotEdge[]; byId: Map<string, Marked>; layers: SnapshotLayer[] }) {
  const ls = [...layers].sort((a, b) => b.order - a.order);
  const count = new Map<string, number>();
  for (const e of edges) {
    const k = `${byId.get(e.target_id)?.primary_layer}>${byId.get(e.source_id)?.primary_layer}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return (
    <table className="text-[12px]">
      <thead>
        <tr>
          <th className="label pr-2 text-left font-normal">payer ↓ / supplier →</th>
          {ls.map((l) => (
            <th key={l.id} className="label px-1.5 font-normal">
              {l.short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ls.map((a) => (
          <tr key={a.id} className="border-t border-rule">
            <th className="pr-2 text-left font-cond font-normal text-ink-2">{a.short}</th>
            {ls.map((b) => {
              const n = count.get(`${a.id}>${b.id}`) ?? 0;
              return (
                <td key={b.id} className={`num px-1.5 text-center ${n ? "text-ink" : "text-ink-3"}`}>
                  {n || "·"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
