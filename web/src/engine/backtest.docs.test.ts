/**
 * Keeps the backtest table in docs/methodology.md honest: it is generated from the engine and the
 * committed data, and this test fails if the doc drifts. Regenerate with `npm run backtest:report`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Snapshot } from "../types";
import { replay, score, summarize, type ScoredRow } from "./backtest";
import { toNodes } from "./propagate";
import type { Backtests, ModelParams } from "./types";

const DOC = new URL("../../../docs/methodology.md", import.meta.url);
const START = "<!-- backtest:start -->";
const END = "<!-- backtest:end -->";

function table(): string {
  const read = <T,>(f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), "utf8")) as T;
  const bt = read<Backtests>("backtests.json");
  const snap = read<Snapshot>("snapshot_latest.json");
  const params = read<ModelParams>("model.json");
  const nodes = toNodes(snap.companies);
  const f = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(2)}%`);
  const row = (name: string, w: string, s: ReturnType<typeof summarize>) =>
    `| ${name} | ${w}d | ${s.n} | ${f(s.maeModel)} | ${f(s.maeNaive)} | ${s.hitRate == null ? "—" : `${Math.round(s.hitRate * 100)}%`} | ${
      s.spearman == null ? "—" : s.spearman.toFixed(2).replace("-", "−")
    } |`;
  const lines = [
    "| Event | Window | n | Model MAE | Do-nothing MAE | Direction right | Spearman ρ |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const w of bt.windows.map(String)) {
    const pooled: ScoredRow[] = [];
    for (const ev of bt.events) {
      const s = score(replay(ev, nodes, snap.edges, params), ev, w);
      pooled.push(...s.rows);
      if (w === "1") lines.push(row(ev.name, w, s));
    }
    lines.push(row("**Pooled**", w, summarize(pooled)));
  }
  return lines.join("\n");
}

it("docs/methodology.md backtest table matches the engine on the committed data", () => {
  const doc = readFileSync(DOC, "utf8").replace(/\r\n/g, "\n"); // checkouts may use CRLF on Windows
  const expected = `${START}\n${table()}\n${END}`;
  if (process.env.WRITE_BACKTEST_REPORT || process.env.npm_lifecycle_event === "backtest:report") {
    writeFileSync(DOC, doc.replace(new RegExp(`${START}[\\s\\S]*?${END}`), expected));
    return;
  }
  expect(doc).toContain(expected);
});
