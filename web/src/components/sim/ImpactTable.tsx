import { useState } from "react";
import type { Marked } from "../../data/derived";
import type { EngineNode, PropagationResult } from "../../engine/types";
import { assumptionsOf, whyChain } from "../../engine/why";
import { pct, tone, toneClass, usdDelta } from "../../lib/format";
import { layerVar } from "../../lib/layers";
import { useUi } from "../../state/store";

export function ImpactTable({
  result,
  names,
  byId,
  revealHop,
}: {
  result: PropagationResult;
  names: Map<string, EngineNode>;
  byId: Map<string, Marked>;
  revealHop: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const select = useUi((s) => s.select);
  const rows = showAll ? result.impacts : result.impacts.slice(0, 15);
  return (
    <div>
      <table className="w-full text-[12px]">
        <caption className="sr-only">Affected companies ranked by modelled dollar change</caption>
        <thead>
          <tr className="border-b border-rule-strong text-left">
            <th className="label py-1.5 pr-2 font-normal">#</th>
            <th className="label py-1.5 pr-2 font-normal">Company</th>
            <th className="label py-1.5 pr-2 text-right font-normal">Hop</th>
            <th className="label py-1.5 pr-2 text-right font-normal">Modelled move</th>
            <th className="label py-1.5 pr-3 text-right font-normal">$ change</th>
            <th className="label py-1.5 font-normal">Why (each step links to its source)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((imp, i) => {
            const c = byId.get(imp.id);
            const main = imp.contributions[0];
            const others = imp.contributions.length - 1;
            const assumptions = assumptionsOf(main);
            return (
              <tr
                key={imp.id}
                className={`border-b border-rule align-top transition-opacity duration-300 ${imp.hop > revealHop ? "opacity-20" : ""}`}
                data-testid="impact-row"
              >
                <td className="num py-1.5 pr-2 text-ink-3">{i + 1}</td>
                <td className="py-1.5 pr-2">
                  <button className="flex items-center gap-1.5 text-left hover:underline" onClick={() => select(imp.id)}>
                    <span className="inline-block h-2 w-2 shrink-0" style={{ background: layerVar(imp.layer) }} aria-hidden />
                    <span className="font-cond text-[13px] text-ink">{c?.name ?? imp.id}</span>
                  </button>
                  <span className="pl-3.5 text-[11px] text-ink-3">{imp.layer}</span>
                </td>
                <td className="num py-1.5 pr-2 text-right text-ink-2">{imp.hop}</td>
                <td className={`num py-1.5 pr-2 text-right ${toneClass[tone(imp.pct)]}`}>{pct(imp.pct, 2)}</td>
                <td className="num py-1.5 pr-3 text-right text-ink">{usdDelta(imp.usd)}</td>
                <td className="py-1.5 leading-snug text-ink-2">
                  <span className={toneClass[tone(imp.pct)]}>{imp.pct >= 0 ? "↑ " : "↓ "}</span>
                  {whyChain(main, names).map((p, k) => (
                    <span key={k}>
                      {k > 0 && <span className="text-ink-3"> → </span>}
                      {p.text}
                      {p.href && (
                        <a href={p.href} target="_blank" rel="noreferrer" className="ml-0.5 text-focus" aria-label={`source for: ${p.text}`}>
                          ↗
                        </a>
                      )}
                    </span>
                  ))}
                  <span className="num text-ink-3"> ({pct(main.pct, 2)})</span>
                  {assumptions.length > 0 && <div className="mt-0.5 text-[11px] text-warn">assumption: {assumptions.join("; ")}</div>}
                  {others > 0 && (
                    <details className="mt-0.5 text-[11px]">
                      <summary className="cursor-pointer text-ink-3">
                        +{others} more path{others > 1 ? "s" : ""}
                      </summary>
                      <ul className="mt-1 space-y-1 border-l border-rule pl-2">
                        {imp.contributions.slice(1).map((c, j) => (
                          <li key={j}>
                            {whyChain(c, names).map((p, k) => (
                              <span key={k}>
                                {k > 0 && <span className="text-ink-3"> → </span>}
                                {p.text}
                                {p.href && (
                                  <a href={p.href} target="_blank" rel="noreferrer" className="ml-0.5 text-focus" aria-label={`source for: ${p.text}`}>
                                    ↗
                                  </a>
                                )}
                              </span>
                            ))}{" "}
                            <span className="num text-ink-3">({pct(c.pct, 2)})</span>
                            {assumptionsOf(c).length > 0 && <div className="text-warn">assumption: {assumptionsOf(c).join("; ")}</div>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {result.impacts.length > 15 && (
        <button className="mt-2 font-cond text-[12px] text-ink-2 underline" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show top 15" : `Show all ${result.impacts.length}`}
        </button>
      )}
    </div>
  );
}
