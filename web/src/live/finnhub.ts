/**
 * Optional live mode: a Finnhub trade WebSocket opened with the VISITOR's own API key.
 * The key is kept only in this browser's localStorage and only ever sent to finnhub.io.
 *
 * Protocol: wss://ws.finnhub.io?token=KEY ; send {"type":"subscribe","symbol":"NVDA"} ;
 * receive {"type":"trade","data":[{"s":"NVDA","p":123.4,"t":1760000000000,"v":10}]}.
 */
import type { SnapshotCompany } from "../types";
import { storage } from "../state/store";
import { useLive } from "./store";

export const KEY_STORAGE = "atlas.finnhubKey";
// Free-tier symbol cap as reported by third-party API directories (Finnhub's own docs are
// client-rendered and could not be checked); subscriptions beyond it are simply not sent.
export const MAX_SYMBOLS = 50;

let socket: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let wanted = false;

/** US symbol to subscribe for a company (ADR live symbol if set; none for non-US listings). */
export function liveSymbol(c: SnapshotCompany): string | null {
  if (!c.is_public) return null;
  if (c.live_symbol) return c.live_symbol;
  return c.ticker && !c.ticker.includes(".") ? c.ticker : null;
}

/** Largest companies first, so the cap keeps the ones that move layer totals most. */
export function subscriptions(companies: SnapshotCompany[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of [...companies].sort((a, b) => b.market_cap_usd - a.market_cap_usd)) {
    const s = liveSymbol(c);
    if (s && out.size < MAX_SYMBOLS) out.set(s, c.id);
  }
  return out;
}

export function getKey(): string | null {
  return storage.get(KEY_STORAGE);
}

export function setKey(key: string | null): void {
  storage.set(KEY_STORAGE, key && key.trim() ? key.trim() : null);
}

export function disconnect(): void {
  wanted = false;
  if (retryTimer) clearTimeout(retryTimer);
  socket?.close();
  socket = null;
  useLive.getState().reset();
}

export function connect(companies: SnapshotCompany[]): void {
  const key = getKey();
  if (!key) return;
  wanted = true;
  socket?.close();
  const { setStatus, tick } = useLive.getState();
  const subs = subscriptions(companies);
  setStatus("connecting");
  const ws = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(key)}`);
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    for (const s of subs.keys()) ws.send(JSON.stringify({ type: "subscribe", symbol: s }));
    setStatus("live");
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { type: string; data?: { s: string; p: number; t: number }[]; msg?: string };
      if (msg.type === "trade" && msg.data) {
        // keep the last trade per symbol in this batch
        const last = new Map<string, { p: number; t: number }>();
        for (const d of msg.data) last.set(d.s, { p: d.p, t: d.t });
        for (const [s, d] of last) {
          const id = subs.get(s);
          if (id) tick(id, d.p, d.t);
        }
      } else if (msg.type === "error") {
        setStatus("error", msg.msg ?? "Finnhub error");
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onerror = () => setStatus("error", "WebSocket error - check the API key");
  ws.onclose = () => {
    if (socket !== ws || !wanted) return;
    setStatus("connecting");
    retry = Math.min(retry + 1, 6);
    retryTimer = setTimeout(() => connect(companies), 1000 * 2 ** retry);
  };
}
