import { motion, useReducedMotion } from "framer-motion";
import { memo, useState } from "react";
import { usd } from "../lib/format";
import { layerFill, layerVar } from "../lib/layers";
import type { SnapshotEdge, SnapshotLayer } from "../types";
import { edgeWidth, FAMILY_STYLE, RELATION_FAMILY, type GraphLayout } from "./networkLayout";
import { Tooltip } from "./Tooltip";

export interface NodeDecoration {
  /** 0..1 emphasis; undefined = default */
  opacity?: number;
  /** text badge under the label (e.g. "+1.2%") */
  badge?: string;
  badgeTone?: "up" | "down";
  ring?: boolean;
}

interface Props {
  layout: GraphLayout;
  edges: SnapshotEdge[];
  layers: SnapshotLayer[];
  width: number;
  height: number;
  selectedId: string | null;
  decorate?: (id: string) => NodeDecoration;
  edgeOpacity?: (e: SnapshotEdge) => number;
  onSelect: (id: string) => void;
  ariaLabel: string;
  /** ids that emit a one-shot expanding ring (the simulator's shock ripple); change `pulseKey` to replay */
  pulse?: string[];
  pulseKey?: string | number;
}

function NetworkGraphImpl({
  layout,
  edges,
  layers,
  width,
  height,
  selectedId,
  decorate,
  edgeOpacity,
  onSelect,
  ariaLabel,
  pulse,
  pulseKey,
}: Props) {
  const reduce = useReducedMotion();
  const [hoverEdge, setHoverEdge] = useState<{ e: SnapshotEdge; x: number; y: number } | null>(null);
  const [hoverNode, setHoverNode] = useState<{ id: string; x: number; y: number } | null>(null);
  const { byId, laneY, laneH } = layout;
  return (
    <div className="relative">
      <svg width={width} height={height} role="group" aria-label={ariaLabel} className="block select-none">
        {layers.map((l) => (
          <g key={l.id}>
            <rect x={0} y={laneY(l.order) - laneH / 2} width={width} height={laneH} fill={layerVar(l.id)} opacity={0.05} />
            <line x1={0} x2={width} y1={laneY(l.order) + laneH / 2} y2={laneY(l.order) + laneH / 2} stroke="var(--rule)" />
            <text x={8} y={laneY(l.order) - laneH / 2 + 15} className="font-cond" fontSize={11} fill="var(--ink-3)">
              {l.name}
            </text>
          </g>
        ))}
        <g fill="none">
          {edges.map((e) => {
            const a = byId.get(e.source_id);
            const b = byId.get(e.target_id);
            if (!a || !b) return null;
            const st = FAMILY_STYLE[RELATION_FAMILY[e.relation_type]];
            const mx = (a.x! + b.x!) / 2 + (b.y! - a.y!) * 0.15;
            const my = (a.y! + b.y!) / 2 - (b.x! - a.x!) * 0.15;
            const o = edgeOpacity ? edgeOpacity(e) : 1;
            const d = `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
            return (
              <g key={e.id} opacity={o}>
                <path
                  d={d}
                  stroke={st.stroke}
                  strokeOpacity={st.opacity}
                  strokeWidth={edgeWidth(e)}
                  strokeDasharray={e.confidence === "estimated" ? "5 4" : st.dash}
                />
                <path
                  d={d}
                  stroke="transparent"
                  strokeWidth={10}
                  onPointerEnter={(ev) => setHoverEdge({ e, x: ev.clientX, y: ev.clientY })}
                  onPointerMove={(ev) => setHoverEdge({ e, x: ev.clientX, y: ev.clientY })}
                  onPointerLeave={() => setHoverEdge(null)}
                />
              </g>
            );
          })}
        </g>
        {!reduce && pulse && (
          <g pointerEvents="none" aria-hidden>
            {pulse.map((id) => {
              const n = byId.get(id);
              if (!n) return null;
              return (
                <motion.circle
                  key={`${pulseKey}-${id}`}
                  cx={n.x}
                  cy={n.y}
                  fill="none"
                  stroke={layerVar(n.c.primary_layer)}
                  strokeWidth={2}
                  initial={{ r: n.r, opacity: 0.9 }}
                  animate={{ r: n.r + 22, opacity: 0 }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                />
              );
            })}
          </g>
        )}
        <g>
          {layout.nodes.map((n) => {
            const dec = decorate?.(n.id) ?? {};
            const selected = selectedId === n.id;
            const showLabel = n.r > 9 || selected || dec.ring || dec.badge;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={dec.opacity ?? 1}
                tabIndex={0}
                role="button"
                aria-label={`${n.c.name}, ${usd(n.c.cap)}`}
                aria-pressed={selected}
                className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[var(--focus)]"
                onClick={() => onSelect(n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onSelect(n.id);
                  }
                }}
                onPointerEnter={(ev) => setHoverNode({ id: n.id, x: ev.clientX, y: ev.clientY })}
                onPointerLeave={() => setHoverNode(null)}
              >
                <circle
                  r={n.r}
                  fill={layerFill(n.c.primary_layer, selected ? "85%" : "55%")}
                  stroke={selected || dec.ring ? "var(--ink)" : layerVar(n.c.primary_layer)}
                  strokeWidth={selected || dec.ring ? 2 : 1}
                  strokeDasharray={n.c.is_public ? undefined : "3 2"}
                />
                {showLabel && (
                  <text y={n.r + 11} textAnchor="middle" fontSize={10.5} className="font-cond" fill="var(--ink)" paintOrder="stroke" stroke="var(--surface)" strokeWidth={3}>
                    {n.c.ticker && !n.c.ticker.includes(".") ? n.c.ticker : n.c.name}
                  </text>
                )}
                {dec.badge && (
                  <text
                    y={n.r + 22}
                    textAnchor="middle"
                    fontSize={10}
                    className="num"
                    fill={dec.badgeTone === "down" ? "var(--down)" : "var(--up)"}
                    paintOrder="stroke"
                    stroke="var(--surface)"
                    strokeWidth={3}
                  >
                    {dec.badge}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {hoverEdge && (
        <Tooltip x={hoverEdge.x} y={hoverEdge.y}>
          <div className="space-y-1">
            <div className="font-cond text-ink">
              {byId.get(hoverEdge.e.source_id)?.c.name} → {byId.get(hoverEdge.e.target_id)?.c.name}
            </div>
            <div className="text-ink-2">
              {hoverEdge.e.relation_type.replace(/_/g, " ")} · {hoverEdge.e.magnitude_usd != null ? usd(hoverEdge.e.magnitude_usd) : "value undisclosed"} ·{" "}
              {hoverEdge.e.confidence.replace("_", " ")}
            </div>
            <div className="text-[11px] text-ink-3">{hoverEdge.e.notes}</div>
          </div>
        </Tooltip>
      )}
      {hoverNode && !hoverEdge && (
        <Tooltip x={hoverNode.x} y={hoverNode.y}>
          <span className="font-cond text-ink">{byId.get(hoverNode.id)?.c.name}</span>{" "}
          <span className="num text-ink-2">{usd(byId.get(hoverNode.id)?.c.cap)}</span>
        </Tooltip>
      )}
    </div>
  );
}

export const NetworkGraph = memo(NetworkGraphImpl);
