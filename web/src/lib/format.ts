/** Number formatting for a dense, terminal-style UI. All outputs are tabular-friendly. */

const UNITS: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/** $5.52T, $965B, $12.0B, $350M. `digits` = significant figures (min 3 shown). */
export function usd(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  for (const [div, u] of UNITS) {
    if (a >= div) {
      const x = a / div;
      const decimals = Math.max(0, digits - Math.floor(Math.log10(x)) - 1);
      return `${sign}$${x.toFixed(decimals)}${u}`;
    }
  }
  return `${sign}$${a.toFixed(0)}`;
}

/** Signed USD change: +$12.3B / -$4.1B. */
export function usdDelta(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return (v > 0 ? "+" : v < 0 ? "-" : "±") + usd(Math.abs(v), digits);
}

/** 0.0123 -> "+1.23%". */
export function pct(v: number | null | undefined, decimals = 2, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(decimals);
  return signed && v > 0 ? `+${s}%` : `${s}%`;
}

export function num(v: number | null | undefined, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(decimals);
}

export function price(v: number | null | undefined, ccy: string): string {
  if (v == null) return "—";
  const decimals = v >= 1000 ? 0 : 2;
  const sym = { USD: "$", EUR: "€", JPY: "¥", KRW: "₩" }[ccy] ?? `${ccy} `;
  return `${sym}${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** "3 min ago", "2 h ago", "4 d ago". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Direction class for a change value. */
export function tone(v: number | null | undefined): "up" | "down" | "flat" {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 1e-9) return "flat";
  return v > 0 ? "up" : "down";
}

export const toneClass = { up: "text-up", down: "text-down", flat: "text-ink-3" } as const;
