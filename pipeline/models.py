"""Pydantic entities - the single source of truth for the data contract.

Curated inputs (YAML) are validated against these models, and the JSON snapshot
shapes consumed by the web app are exported as JSON Schema from here
(`uv run pipeline export-schema`), from which the TypeScript types are generated.
"""

from __future__ import annotations

import datetime as dt
from datetime import date, datetime
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

LayerId = str
CompanyId = Annotated[str, Field(pattern=r"^[a-z0-9]+$")]


class RelationType(StrEnum):
    equity_stake = "equity_stake"
    compute_contract = "compute_contract"
    chip_supply = "chip_supply"
    memory_supply = "memory_supply"
    foundry = "foundry"
    equipment_supply = "equipment_supply"
    power_ppa = "power_ppa"
    cloud_hosting = "cloud_hosting"
    distribution_partnership = "distribution_partnership"
    revenue_customer = "revenue_customer"


class Confidence(StrEnum):
    reported = "reported"
    credible_press = "credible_press"
    estimated = "estimated"


class Direction(StrEnum):
    supplies_to = "supplies_to"
    invests_in = "invests_in"


class MagnitudeBasis(StrEnum):
    contract_total = "contract_total"
    monthly_run_rate = "monthly_run_rate"
    investment_amount = "investment_amount"
    stake_value = "stake_value"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# --------------------------------------------------------------------------- curated
class Layer(_Strict):
    id: LayerId
    name: str
    short: str
    order: int
    group: str
    accent: str


class Company(_Strict):
    id: CompanyId
    name: str
    ticker: str | None = None
    live_symbol: str | None = None
    exchange: str | None = None
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    is_public: bool
    primary_layer: LayerId
    secondary_layers: list[LayerId] = Field(default_factory=list)
    hq_country: str = Field(pattern=r"^[A-Z]{2}$")
    logo_url: str | None = None
    listing_note: str | None = None

    @model_validator(mode="after")
    def _public_needs_ticker(self) -> Company:
        if self.is_public and not self.ticker:
            raise ValueError(f"{self.id}: public company needs a ticker")
        if self.primary_layer in self.secondary_layers:
            raise ValueError(f"{self.id}: primary layer repeated in secondary_layers")
        return self


class PrivateValuation(_Strict):
    company_id: CompanyId
    valuation: float = Field(gt=0)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    basis: str
    as_of_date: date
    round: str
    source_url: HttpUrl
    confidence: Confidence
    notes: str | None = None


class Edge(_Strict):
    source_id: CompanyId
    target_id: CompanyId
    relation_type: RelationType
    direction: Direction
    magnitude_usd: float | None = Field(default=None, ge=0)
    magnitude_basis: MagnitudeBasis | None = None
    stake_pct: float | None = Field(default=None, ge=0, le=1)
    supplier_revenue_share: float | None = Field(default=None, ge=0, le=1)
    confidence: Confidence
    evidence_url: HttpUrl
    evidence_date: date
    notes: str = Field(min_length=10)

    @model_validator(mode="after")
    def _consistent(self) -> Edge:
        if (self.magnitude_usd is None) != (self.magnitude_basis is None):
            raise ValueError(f"{self.source_id}->{self.target_id}: magnitude_usd and magnitude_basis go together")
        if self.stake_pct is not None and self.relation_type is not RelationType.equity_stake:
            raise ValueError(f"{self.source_id}->{self.target_id}: stake_pct only valid on equity_stake")
        if (self.relation_type is RelationType.equity_stake) != (self.direction is Direction.invests_in):
            raise ValueError(f"{self.source_id}->{self.target_id}: equity_stake <=> invests_in")
        return self

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.source_id, self.target_id, self.relation_type.value)


class SegmentSplit(_Strict):
    company_id: CompanyId
    fiscal_year: str
    source_url: HttpUrl
    notes: str
    shares: dict[str, float]

    @field_validator("shares")
    @classmethod
    def _non_negative(cls, v: dict[str, float]) -> dict[str, float]:
        if any(s < 0 for s in v.values()):
            raise ValueError("segment shares must be >= 0")
        return v


class Curated(BaseModel):
    """Everything hand-maintained under data/*.yaml, validated."""

    layers: list[Layer]
    companies: list[Company]
    private_valuations: list[PrivateValuation]
    edges: list[Edge]
    segments: list[SegmentSplit]


# --------------------------------------------------------------------------- outputs
class Valuation(BaseModel):
    valuation_usd: float
    valuation: float
    currency: str
    as_of_date: date
    round: str
    source_url: str
    confidence: Confidence
    age_days: int


class SnapshotCompany(BaseModel):
    id: str
    name: str
    ticker: str | None
    live_symbol: str | None
    exchange: str | None
    currency: str
    is_public: bool
    primary_layer: str
    secondary_layers: list[str]
    hq_country: str
    logo_url: str | None
    listing_note: str | None
    market_cap_usd: float
    price: float | None
    price_date: date | None
    day_change_pct: float | None
    fx_usd_per_unit: float | None
    shares: float | None
    revenue_ttm_usd: float | None
    source: str
    valuation: Valuation | None
    segments: dict[str, float]


class SnapshotLayer(BaseModel):
    id: str
    name: str
    short: str
    order: int
    group: str
    accent: str
    total_primary_usd: float
    total_segment_usd: float
    day_change_pct: float | None
    company_count: int
    public_count: int


class SnapshotEdge(BaseModel):
    id: str
    source_id: str
    target_id: str
    relation_type: RelationType
    direction: Direction
    magnitude_usd: float | None
    magnitude_basis: MagnitudeBasis | None
    stake_pct: float | None
    supplier_revenue_share: float | None
    confidence: Confidence
    evidence_url: str
    evidence_date: date
    notes: str


class Snapshot(BaseModel):
    schema_version: int = 1
    run_id: str
    generated_at: datetime
    as_of: date
    total_market_cap_usd: float
    outside_stack_segment_usd: float
    layers: list[SnapshotLayer]
    companies: list[SnapshotCompany]
    edges: list[SnapshotEdge]


class CheckStatus(StrEnum):
    pass_ = "pass"
    warn = "warn"
    fail = "fail"


class CheckResult(BaseModel):
    name: str
    status: CheckStatus
    detail: str
    failing: list[str] = Field(default_factory=list)


class SourceInfo(BaseModel):
    name: str
    kind: str
    records: int
    detail: str = ""


class LineageNode(BaseModel):
    id: str
    label: str
    kind: str  # source | transform | check | output
    rows: int | None = None


class Lineage(BaseModel):
    run_id: str
    status: str
    started_at: datetime
    finished_at: datetime
    duration_s: float
    as_of: date | None
    pipeline_version: str
    sources: list[SourceInfo]
    row_counts: dict[str, int]
    checks: list[CheckResult]
    nodes: list[LineageNode]
    links: list[tuple[str, str]]
    outputs: list[str]
    history: list[dict[str, str | int | float]] = Field(default_factory=list)


class LayerIndexSeries(BaseModel):
    dates: list[date]
    levels: dict[str, list[float]]
    day_returns: dict[str, list[float]]


class Analytics(BaseModel):
    as_of: date
    window_start: date
    company_ids: list[str]
    correlation: list[list[float | None]]
    layer_index: LayerIndexSeries
    beta: dict[str, dict[str, float | None]]
    corr_to_layer: dict[str, dict[str, float | None]]
    layer_correlation: dict[str, dict[str, float | None]]
    vol_60d: dict[str, float | None]
    layer_vol_60d: dict[str, float | None]
    return_1y: dict[str, float | None]
    layer_return_1y: dict[str, float | None]


class Elasticity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    up: float = Field(ge=0, le=2)
    down: float = Field(ge=0, le=2)


class ModelParams(BaseModel):
    """Propagation-model parameters (config/model.yaml -> model.json)."""

    model_config = ConfigDict(extra="forbid")
    elasticity: dict[RelationType, Elasticity]
    decay: float = Field(ge=0, le=1)
    max_hops: int = Field(ge=1, le=5)
    beta_blend: float = Field(ge=0, le=1)
    valuation_to_demand: float = Field(ge=0, le=2)
    contract_years: float = Field(gt=0)
    null_magnitude_share: float = Field(ge=0, le=1)
    max_exposure: float = Field(gt=0)

    @model_validator(mode="after")
    def _all_relations(self) -> ModelParams:
        missing = set(RelationType) - set(self.elasticity)
        if missing:
            raise ValueError(f"elasticity missing for {sorted(missing)}")
        return self


class ShockType(StrEnum):
    ipo = "ipo"
    valuation_change = "valuation_change"
    earnings_beat_miss = "earnings_beat_miss"
    supply_shock = "supply_shock"
    demand_shock = "demand_shock"


class ScenarioSpec(_Strict):
    company_id: CompanyId
    type: ShockType
    pct: float | None = None
    valuation_usd: float | None = Field(default=None, gt=0)
    prior_valuation_usd: float | None = Field(default=None, gt=0)


class BacktestEventSpec(_Strict):
    id: str
    name: str
    date: dt.date
    effective_date: dt.date
    description: str
    source_url: HttpUrl
    prior_source_url: HttpUrl | None = None
    scenario: ScenarioSpec

    @model_validator(mode="after")
    def _effective_after_date(self) -> BacktestEventSpec:
        if self.effective_date < self.date:
            raise ValueError(f"{self.id}: effective_date before date")
        return self


class BacktestCompany(BaseModel):
    id: str
    cap_before: float
    actual: dict[str, float | None]


class BacktestEvent(BaseModel):
    id: str
    name: str
    date: dt.date
    effective_date: dt.date
    description: str
    source_url: str
    prior_source_url: str | None
    scenario: ScenarioSpec
    companies: list[BacktestCompany]
    edge_ids: list[str]
    revenue: dict[str, float | None]


class Backtests(BaseModel):
    generated_at: datetime
    spec_hash: str
    benchmark: str
    windows: list[int]
    events: list[BacktestEvent]


class PriceSeries(BaseModel):
    dates: list[date]
    price: dict[str, list[float | None]]
    market_cap_usd: dict[str, list[float | None]]
