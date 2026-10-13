import { describe, expect, it } from "vitest";
import type { Marked } from "./derived";
import { layerItems, outsideStack } from "./derived";

const mk = (id: string, primary: string, cap: number, segments: Record<string, number>): Marked =>
  ({ id, name: id, primary_layer: primary, cap, segments, change: 0, live: false, is_public: true }) as unknown as Marked;

describe("layerItems", () => {
  const cos = [mk("msft", "cloud", 100, { cloud: 0.4, apps: 0.4, other: 0.2 }), mk("crm", "apps", 50, { apps: 1 })];

  it("primary mode counts each company once, in full", () => {
    const items = layerItems(cos, "primary");
    expect(items.cloud.map((i) => [i.company.id, i.value])).toEqual([["msft", 100]]);
    expect(items.apps.map((i) => i.value)).toEqual([50]);
  });

  it("segment mode splits by share, sorts by value and leaves 'other' out of the bands", () => {
    const items = layerItems(cos, "segment");
    expect(items.apps.map((i) => [i.company.id, i.value])).toEqual([["crm", 50], ["msft", 40]]);
    expect(items.cloud[0].share).toBe(0.4);
    const inBands = Object.values(items).flat().reduce((s, i) => s + i.value, 0);
    expect(inBands + outsideStack(cos)).toBeCloseTo(150);
  });
});
