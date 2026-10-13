import { useQuery } from "@tanstack/react-query";
import type { Analytics, Lineage, PriceSeries, Snapshot } from "../types";
import type { Backtests, ModelParams } from "../engine/types";

const BASE = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(BASE + name, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

// The snapshot is refetched every 5 minutes so an open tab picks up the scheduled refresh.
export const useSnapshot = () =>
  useQuery({ queryKey: ["snapshot"], queryFn: () => getJson<Snapshot>("snapshot_latest.json"), refetchInterval: 300_000 });
export const useAnalytics = () => useQuery({ queryKey: ["analytics"], queryFn: () => getJson<Analytics>("analytics.json") });
export const usePrices = () => useQuery({ queryKey: ["prices"], queryFn: () => getJson<PriceSeries>("prices_1y.json") });
export const useLineage = () =>
  useQuery({ queryKey: ["lineage"], queryFn: () => getJson<Lineage>("lineage.json"), refetchInterval: 300_000 });
export const useBacktests = () => useQuery({ queryKey: ["backtests"], queryFn: () => getJson<Backtests>("backtests.json") });
export const useModelParams = () =>
  useQuery({ queryKey: ["model"], queryFn: () => getJson<ModelParams>("model.json"), staleTime: Infinity });
