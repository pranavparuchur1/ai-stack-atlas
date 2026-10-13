import { create } from "zustand";

export type LiveStatus = "off" | "connecting" | "live" | "error";

interface LiveState {
  status: LiveStatus;
  /** latest trade price by company id (listing currency of the live symbol) */
  prices: Record<string, { price: number; ts: number; prev: number | null }>;
  error: string | null;
  setStatus: (s: LiveStatus, error?: string | null) => void;
  tick: (id: string, price: number, ts: number) => void;
  reset: () => void;
}

export const useLive = create<LiveState>((set) => ({
  status: "off",
  prices: {},
  error: null,
  setStatus: (status, error = null) => set({ status, error }),
  tick: (id, price, ts) =>
    set((s) => ({ prices: { ...s.prices, [id]: { price, ts, prev: s.prices[id]?.price ?? null } } })),
  reset: () => set({ status: "off", prices: {}, error: null }),
}));
