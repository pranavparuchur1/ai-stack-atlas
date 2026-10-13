import { describe, expect, it } from "vitest";
import { ago, pct, usd, usdDelta } from "./format";

describe("format", () => {
  it("compacts USD to 3 significant figures", () => {
    expect(usd(5.518e12)).toBe("$5.52T");
    expect(usd(965e9)).toBe("$965B");
    expect(usd(12e9)).toBe("$12.0B");
    expect(usd(350e6)).toBe("$350M");
    expect(usd(null)).toBe("—");
  });
  it("signs deltas and percentages", () => {
    expect(usdDelta(-4.1e9)).toBe("-$4.10B");
    expect(usdDelta(2e12)).toBe("+$2.00T");
    expect(pct(0.0123)).toBe("+1.23%");
    expect(pct(-0.5, 0)).toBe("-50%");
  });
  it("describes age", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    expect(ago("2026-10-13T11:50:00Z", now)).toBe("10 min ago");
    expect(ago("2026-10-10T12:00:00Z", now)).toBe("3 d ago");
  });
});
