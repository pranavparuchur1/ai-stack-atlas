import type { LayerId } from "../types";

export const layerVar = (id: string) => `var(--layer-${id})`;

/** Tile fill: the layer colour mixed into the raised surface (strength from the theme's --tile-alpha). */
export const layerFill = (id: string, strength = "var(--tile-alpha)") =>
  `color-mix(in srgb, var(--layer-${id}) ${strength}, var(--surface-raised))`;

export const LAYER_NUMBER: Record<LayerId, string> = {
  power: "1",
  infra: "2",
  semicap: "3a",
  chips: "3b",
  cloud: "4",
  models: "5",
  apps: "6",
};
