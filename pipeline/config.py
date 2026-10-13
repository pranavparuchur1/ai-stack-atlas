"""Paths and runtime configuration."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class CheckThresholds:
    private_valuation_max_age_days: int = 365
    price_stale_days: int = 4
    max_daily_cap_jump: float = 0.60
    reconcile_tolerance: float = 1e-6


@dataclass(frozen=True)
class Settings:
    data_dir: Path = ROOT / "data"
    config_dir: Path = ROOT / "config"
    out_dir: Path = ROOT / "web" / "public" / "data"
    warehouse: Path = ROOT / "data" / "warehouse" / "atlas.duckdb"
    providers: tuple[str, ...] = ("finnhub", "polygon", "yfinance")
    history_days: int = 400
    refetch_overlap_days: int = 5
    analytics_window_days: int = 365
    vol_window: int = 60
    checks: CheckThresholds = field(default_factory=CheckThresholds)

    @classmethod
    def load(cls, root: Path = ROOT, **overrides: Any) -> Settings:
        raw: dict[str, Any] = {}
        cfg = root / "config" / "pipeline.yaml"
        if cfg.exists():
            raw = yaml.safe_load(cfg.read_text(encoding="utf-8")) or {}
        checks = CheckThresholds(**raw.pop("checks", {}))
        if "providers" in raw:
            raw["providers"] = tuple(raw["providers"])
        base = cls(
            data_dir=root / "data",
            config_dir=root / "config",
            out_dir=root / "web" / "public" / "data",
            warehouse=root / "data" / "warehouse" / "atlas.duckdb",
            checks=checks,
            **raw,
        )
        return base if not overrides else cls(**{**base.__dict__, **overrides})
