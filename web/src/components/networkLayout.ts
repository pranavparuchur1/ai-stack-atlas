import { forceCollide, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { useMemo } from "react";
import type { Marked } from "../data/derived";
import type { SnapshotEdge, SnapshotLayer } from "../types";

export const RELATION_FAMILY: Record<SnapshotEdge["relation_type"], "equity" | "compute" | "hardware" | "power"> = {
  equity_stake: "equity",
  compute_contract: "compute",
  cloud_hosting: "compute",
  revenue_customer: "compute",
  distribution_partnership: "compute",
  chip_supply: "hardware",
  memory_supply: "hardware",
  foundry: "hardware",
  equipment_supply: "hardware",
  power_ppa: "power",
};

// Edge families are told apart by stroke pattern + tone (not hue), so they never compete with layer colours.
export const FAMILY_STYLE = {
  equity: { label: "Equity stake", stroke: "var(--ink)", dash: undefined, opacity: 0.55 },
  compute: { label: "Compute / cloud / customer", stroke: "var(--ink-2)", dash: undefined, opacity: 0.45 },
  hardware: { label: "Chips / memory / foundry / equipment", stroke: "var(--ink-2)", dash: "1 3", opacity: 0.6 },
  power: { label: "Power purchase", stroke: "var(--warn)", dash: undefined, opacity: 0.45 },
} as const;

export interface GNode extends SimulationNodeDatum {
  id: string;
  r: number;
  lane: number;
  c: Marked;
}

export interface GraphLayout {
  nodes: GNode[];
  byId: Map<string, GNode>;
  laneY: (order: number) => number;
  laneH: number;
}

/** Deterministic layout: nodes pinned to horizontal layer lanes; links pull partners together in x. */
export function useGraphLayout(companies: Marked[], edges: SnapshotEdge[], layers: SnapshotLayer[], width: number, height: number) {
  return useMemo<GraphLayout | null>(() => {
    if (!width || !companies.length) return null;
    const maxCap = Math.max(...companies.map((c) => c.cap));
    const order = new Map(layers.map((l) => [l.id, l.order]));
    const laneH = height / layers.length;
    const laneY = (o: number) => (layers.length - o + 0.5) * laneH; // apps top, power bottom
    // Layered (Sugiyama-style) ordering: start lanes sorted by cap, then repeatedly sort each lane by the
    // mean x of its neighbours so connected companies line up vertically; a short force pass removes overlaps.
    const lanes = new Map<string, Marked[]>();
    for (const c of [...companies].sort((a, b) => b.cap - a.cap)) lanes.set(c.primary_layer, [...(lanes.get(c.primary_layer) ?? []), c]);
    const nbrs = new Map<string, string[]>();
    for (const e of edges) {
      nbrs.set(e.source_id, [...(nbrs.get(e.source_id) ?? []), e.target_id]);
      nbrs.set(e.target_id, [...(nbrs.get(e.target_id) ?? []), e.source_id]);
    }
    const xs = new Map<string, number>();
    const place = (peers: Marked[]) => peers.forEach((c, i) => xs.set(c.id, ((i + 0.5) / peers.length) * width));
    for (const peers of lanes.values()) {
      // centre-out seeding: biggest company in the middle of its lane
      const mid: Marked[] = [];
      peers.forEach((c, i) => (i % 2 ? mid.push(c) : mid.unshift(c)));
      place(mid);
      lanes.set(peers[0].primary_layer, mid);
    }
    for (let sweep = 0; sweep < 6; sweep++) {
      for (const [lid, peers] of lanes) {
        const key = (c: Marked) => {
          const ns = (nbrs.get(c.id) ?? []).filter((n) => xs.has(n));
          return ns.length ? ns.reduce((s, n) => s + xs.get(n)!, 0) / ns.length : xs.get(c.id)!;
        };
        const sorted = [...peers].sort((a, b) => key(a) - key(b));
        lanes.set(lid, sorted);
        place(sorted);
      }
    }
    const nodes: GNode[] = companies.map((c) => {
      const lane = order.get(c.primary_layer) ?? 1;
      return { id: c.id, c, lane, r: 3.5 + 24 * Math.sqrt(c.cap / maxCap), x: xs.get(c.id)!, y: laneY(lane) };
    });
    const target = new Map(nodes.map((n) => [n.id, n.x!]));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const sim = forceSimulation(nodes)
      .force("x", forceX<GNode>((d) => target.get(d.id)!).strength(0.25))
      .force("y", forceY<GNode>((d) => laneY(d.lane)).strength(0.6))
      .force("collide", forceCollide<GNode>((d) => d.r + 4).iterations(3))
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    for (const n of nodes) {
      n.x = Math.max(n.r + 4, Math.min(width - n.r - 4, n.x!));
      n.y = Math.max(laneY(n.lane) - laneH / 2 + n.r + 2, Math.min(laneY(n.lane) + laneH / 2 - n.r - 2, n.y!));
    }
    return { nodes, byId, laneY, laneH };
  }, [companies, edges, layers, width, height]);
}

export function edgeWidth(e: SnapshotEdge): number {
  if (e.magnitude_usd == null) return 0.8;
  const t = Math.log10(Math.max(e.magnitude_usd, 1e8) / 1e8) / Math.log10(3e11 / 1e8);
  return 0.8 + 3.2 * Math.min(1, t);
}

