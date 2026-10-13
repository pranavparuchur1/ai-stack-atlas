import { useMemo, useState } from "react";
import type { LayerItem } from "../data/derived";
import { pct, tone, toneClass, usd } from "../lib/format";
import { layerVar } from "../lib/layers";
import { useUi } from "../state/store";
import type { LayerId, SnapshotLayer } from "../types";

type Key = "name" | "layer" | "value" | "change";

/** Accessible table alternative to the treemap: the same items, sortable, one row per company-layer. */
export function StackTable({ items, layers }: { items: Record<LayerId, LayerItem[]>; layers: SnapshotLayer[] }) {
  const select = useUi((s) => s.select);
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: "value", desc: true });
  const rows = useMemo(() => {
    const order = new Map(layers.map((l) => [l.id, l.order]));
    const all = Object.values(items).flat();
    const v = (r: LayerItem): string | number =>
      sort.key === "name"
        ? r.company.name
        : sort.key === "layer"
          ? -(order.get(r.layer) ?? 0)
          : sort.key === "value"
            ? r.value
            : (r.company.change ?? -1e9);
    return all.sort((a, b) => {
      const x = v(a);
      const y = v(b);
      const c = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
      return sort.desc ? -c : c;
    });
  }, [items, sort, layers]);
  const header = (key: Key, label: string, align = "text-left") => (
    <th scope="col" className={`label py-1.5 pr-3 font-normal ${align}`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className="hover:text-ink" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}>
        {label} {sort.key === key ? (sort.desc ? "↓" : "↑") : ""}
      </button>
    </th>
  );
  return (
    <table className="w-full text-[12px]">
      <caption className="sr-only">Companies by market cap; activate a column header to sort, a name to open details</caption>
      <thead>
        <tr className="border-b border-rule-strong">
          {header("name", "Company")}
          {header("layer", "Layer")}
          {header("value", "Market cap (this layer)", "text-right")}
          {header("change", "Today", "text-right")}
          <th scope="col" className="label py-1.5 font-normal">
            Status
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-rule">
            <td className="py-1 pr-3">
              <button className="font-cond text-[13px] text-ink hover:underline" onClick={() => select(r.company.id)}>
                {r.company.name}
              </button>{" "}
              <span className="num text-ink-3">{r.company.ticker ?? ""}</span>
            </td>
            <td className="py-1 pr-3 text-ink-2">
              <span className="mr-1.5 inline-block h-2 w-2" style={{ background: layerVar(r.layer) }} aria-hidden />
              {layers.find((l) => l.id === r.layer)?.short}
              {r.share < 1 && <span className="num text-ink-3"> · {Math.round(r.share * 100)}%</span>}
            </td>
            <td className="num py-1 pr-3 text-right text-ink">{usd(r.value)}</td>
            <td className={`num py-1 pr-3 text-right ${toneClass[tone(r.company.change)]}`}>{r.company.is_public ? pct(r.company.change) : "—"}</td>
            <td className="py-1 text-ink-3">{r.company.is_public ? (r.company.live ? "live" : "listed") : "private · last round"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
