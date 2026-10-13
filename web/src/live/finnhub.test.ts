import { describe, expect, it } from "vitest";
import type { SnapshotCompany } from "../types";
import { liveSymbol, MAX_SYMBOLS, subscriptions } from "./finnhub";

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
