import type { ShockType } from "../../engine/types";

export const SHOCKS: { type: ShockType; label: string; help: string }[] = [
  { type: "ipo", label: "IPO", help: "A private company lists at a valuation you choose." },
  { type: "valuation_change", label: "Valuation change", help: "A funding round or re-rating moves its value by ±%." },
  { type: "earnings_beat_miss", label: "Earnings beat / miss", help: "Its stock reacts ±% to results." },
  { type: "supply_shock", label: "Supply shock", help: "It loses % of capacity (e.g. a foundry disruption); customers feel it." },
  { type: "demand_shock", label: "Demand shock", help: "It changes capex / purchases by ±%; suppliers feel it." },
];
