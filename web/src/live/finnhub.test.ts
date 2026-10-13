import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SnapshotCompany } from "../types";
import { connect, disconnect, liveSymbol, MAX_SYMBOLS, setKey, subscriptions } from "./finnhub";
import { useLive } from "./store";

const co = (id: string, ticker: string | null, cap: number, extra: Partial<SnapshotCompany> = {}) =>
  ({ id, ticker, is_public: ticker != null, market_cap_usd: cap, live_symbol: null, ...extra }) as SnapshotCompany;

describe("live subscriptions", () => {
  it("uses US tickers, ADR live symbols, never private or foreign listings", () => {
    expect(liveSymbol(co("nvda", "NVDA", 1))).toBe("NVDA");
    expect(liveSymbol(co("tel", "8035.T", 1))).toBeNull();
    expect(liveSymbol(co("sk", "000660.KS", 1, { live_symbol: "SKHY" }))).toBe("SKHY");
    expect(liveSymbol(co("openai", null, 1))).toBeNull();
  });
  it("caps subscriptions, keeping the largest companies", () => {
    const many = Array.from({ length: 80 }, (_, i) => co(`c${i}`, `T${i}`, i));
    const subs = subscriptions(many);
    expect(subs.size).toBe(MAX_SYMBOLS);
    expect(subs.get("T79")).toBe("c79");
    expect(subs.has("T0")).toBe(false);
  });
});

class FakeSocket {
  static last: FakeSocket | null = null;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.onclose?.();
  }
}

describe("live connection", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    Object.assign(globalThis, {
      WebSocket: FakeSocket,
      window: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
      },
    });
  });
  afterEach(() => disconnect());

  it("does nothing without a key", () => {
    FakeSocket.last = null;
    connect([co("nvda", "NVDA", 10)]);
    expect(FakeSocket.last).toBeNull();
  });

  it("subscribes, maps trades to companies and reports errors", () => {
    setKey("  test-key  ");
    connect([co("nvda", "NVDA", 10), co("tel", "8035.T", 5), co("sk", "000660.KS", 8, { live_symbol: "SKHY" })]);
    const ws = FakeSocket.last!;
    expect(ws.url).toBe("wss://ws.finnhub.io?token=test-key"); // trimmed, sent only to finnhub
    expect(useLive.getState().status).toBe("connecting");
    ws.onopen!();
    expect(ws.sent.map((s) => JSON.parse(s).symbol).sort()).toEqual(["NVDA", "SKHY"]);
    expect(useLive.getState().status).toBe("live");

    ws.onmessage!({ data: JSON.stringify({ type: "trade", data: [{ s: "NVDA", p: 230, t: 1 }, { s: "NVDA", p: 231, t: 2 }, { s: "ZZZ", p: 1, t: 3 }] }) });
    expect(useLive.getState().prices.nvda).toEqual({ price: 231, ts: 2, prev: null });
    ws.onmessage!({ data: JSON.stringify({ type: "trade", data: [{ s: "NVDA", p: 229, t: 4 }] }) });
    expect(useLive.getState().prices.nvda.prev).toBe(231);
    ws.onmessage!({ data: "not json" }); // ignored
    ws.onmessage!({ data: JSON.stringify({ type: "error", msg: "Invalid API key" }) });
    expect(useLive.getState()).toMatchObject({ status: "error", error: "Invalid API key" });
  });

  it("disconnect clears state and the key can be removed", () => {
    setKey("k");
    connect([co("nvda", "NVDA", 10)]);
    disconnect();
    expect(useLive.getState().status).toBe("off");
    setKey(null);
    expect(store.has("atlas.finnhubKey")).toBe(false);
  });
});
