"""Shared fixtures: a deterministic offline market-data provider and a temp project root."""

from __future__ import annotations

import shutil
import zlib
from collections.abc import Sequence
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pipeline.config import ROOT, Settings
from pipeline.extract.providers.base import FUNDAMENTAL_COLUMNS, FX_COLUMNS, HISTORY_COLUMNS

TODAY = date(2026, 10, 13)

FX_LEVEL = {"EUR": 1.12, "JPY": 0.0063, "KRW": 0.00075, "TWD": 0.031}


def _business_days(start: date, end: date) -> list[date]:
    return [d.date() for d in pd.bdate_range(start, end)]


class FakeProvider:
    """Seeded random-walk prices; every ticker trades every business day."""

    name = "fake"

    def __init__(self, seed: int = 7, missing_fx: Sequence[str] = ()) -> None:
        self.seed = seed
        self.missing_fx = set(missing_fx)
        self.history_calls: list[tuple[date, date]] = []

    def _walk(self, key: str, days: list[date], level: float, vol: float) -> np.ndarray:
        rng = np.random.default_rng(zlib.crc32(f"{self.seed}:{key}".encode()))
        # anchor the walk to a fixed epoch so overlapping windows agree day-by-day
        epoch = _business_days(date(2025, 1, 1), days[-1]) if days else []
        steps = rng.normal(0.0005, vol, size=len(epoch))
        path = level * np.exp(np.cumsum(steps))
        lookup = dict(zip(epoch, path, strict=True))
        return np.array([lookup[d] for d in days])

    def history(self, tickers: Sequence[str], start: date, end: date) -> pd.DataFrame:
        self.history_calls.append((start, end))
        days = _business_days(start, end)
        rows = [
            {"ticker": t, "date": d, "close": float(p)}
            for t in tickers
            for d, p in zip(days, self._walk(t, days, 100.0, 0.02), strict=True)
        ]
        return pd.DataFrame(rows, columns=HISTORY_COLUMNS)

    def fx_history(self, currencies: Sequence[str], start: date, end: date) -> pd.DataFrame:
        days = _business_days(start, end)
        rows = [
            {"currency": c, "date": d, "usd_per_unit": float(v)}
            for c in currencies
            if c != "USD" and c not in self.missing_fx
            for d, v in zip(days, self._walk("fx" + c, days, FX_LEVEL.get(c, 1.0), 0.003), strict=True)
        ]
        return pd.DataFrame(rows, columns=FX_COLUMNS)

    def fundamentals(self, tickers: Sequence[str]) -> pd.DataFrame:
        rows = [
            {"ticker": t, "shares": 1e9 + 1e7 * i, "revenue_ttm": 5e10, "revenue_currency": "USD"}
            for i, t in enumerate(tickers)
        ]
        return pd.DataFrame(rows, columns=FUNDAMENTAL_COLUMNS)


@pytest.fixture
def fake_provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """A throwaway project root containing copies of the real curated data and config."""
    shutil.copytree(ROOT / "data", tmp_path / "data", ignore=shutil.ignore_patterns("warehouse"))
    shutil.copytree(ROOT / "config", tmp_path / "config")
    return tmp_path


@pytest.fixture
def settings(project: Path) -> Settings:
    return Settings.load(project)


@pytest.fixture
def today() -> date:
    return TODAY


def days_back(n: int) -> date:
    return TODAY - timedelta(days=n)
