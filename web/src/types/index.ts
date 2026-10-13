// Public types for the app. Data-file shapes are generated from the pipeline's
// Pydantic models (see scripts/gen-types.mjs); app-level types live here.
export type { Snapshot, SnapshotCompany, SnapshotEdge, SnapshotLayer, Valuation } from "./generated/Snapshot";
export type { Analytics } from "./generated/Analytics";
export type { PriceSeries } from "./generated/PriceSeries";
export type { Lineage, CheckResult, LineageNode, SourceInfo } from "./generated/Lineage";

export type LayerId = "power" | "infra" | "semicap" | "chips" | "cloud" | "models" | "apps";
export type Attribution = "primary" | "segment";

export const LAYER_IDS: LayerId[] = ["power", "infra", "semicap", "chips", "cloud", "models", "apps"];
