from __future__ import annotations

import math
from datetime import date

import pandas as pd
import pytest

from pipeline.models import Company, PrivateValuation
from pipeline.transform.market_cap import attach_fx, fx_lookup, latest_marks, market_caps, private_marks

FX = pd.DataFrame(
    {
        "currency": ["KRW", "KRW", "EUR"],
        "date": [date(2026, 10, 9), date(2026, 10, 12), date(2026, 10, 1)],
        "usd_per_unit": [0.0007, 0.0008, 1.10],
    }
)


def test_fx_lookup_uses_latest_prior_rate() -> None:
    assert fx_lookup(FX, "USD", date(2026, 1, 1)) == 1.0
    assert fx_lookup(FX, "KRW", date(2026, 10, 11)) == pytest.approx(0.0007)  # weekend -> Friday
    assert fx_lookup(FX, "KRW", date(2026, 10, 13)) == pytest.approx(0.0008)
    assert fx_lookup(FX, "KRW", date(2026, 1, 1)) is None
    assert fx_lookup(FX, "JPY", date(2026, 10, 13)) is None


def test_attach_fx_backward_asof_and_missing() -> None:
    prices = pd.DataFrame(
        {
            "company_id": ["sk", "sk", "nv", "tel"],
            "ticker": ["000660.KS", "000660.KS", "NVDA", "8035.T"],
            "date": [date(2026, 10, 10), date(2026, 10, 13), date(2026, 10, 13), date(2026, 10, 13)],
            "close": [1_000_000.0, 1_100_000.0, 200.0, 10_000.0],
            "currency": ["KRW", "KRW", "USD", "JPY"],
        }
    )
    out = attach_fx(prices, FX).set_index(["company_id", "date"])
    assert out.loc[("sk", date(2026, 10, 10)), "fx_rate"] == pytest.approx(0.0007)
    assert out.loc[("sk", date(2026, 10, 13)), "fx_rate"] == pytest.approx(0.0008)
    assert out.loc[("nv", date(2026, 10, 13)), "fx_rate"] == 1.0
    assert math.isnan(out.loc[("tel", date(2026, 10, 13)), "fx_rate"])  # no JPY series


def test_market_caps_and_latest_marks() -> None:
    df = pd.DataFrame(
        {
            "company_id": ["a", "a", "b"],
            "date": [date(2026, 10, 12), date(2026, 10, 13), date(2026, 10, 13)],
            "close": [10.0, 11.0, 5.0],
            "fx_rate": [1.0, 1.0, 2.0],
        }
    )
    caps = market_caps(df, {"a": 100.0, "b": 10.0})
    assert caps["market_cap_usd"].tolist() == [1000.0, 1100.0, 100.0]
    last = latest_marks(caps).set_index("company_id")
    assert last.at["a", "day_change_pct"] == pytest.approx(0.10)
    assert last.at["a", "prev_market_cap_usd"] == 1000.0
    assert math.isnan(last.at["b", "day_change_pct"])  # single session -> no change


def test_private_marks_convert_at_round_date() -> None:
    cos = [
        Company(id="m", name="M", currency="EUR", is_public=False, primary_layer="models", hq_country="FR"),
        Company(id="p", name="P", ticker="P", currency="USD", is_public=True, primary_layer="apps", hq_country="US"),
    ]
    vals = [
        PrivateValuation(
            company_id="m",
            valuation=20e9,
            currency="EUR",
            basis="post_money",
            as_of_date=date(2026, 10, 2),
            round="D",
            source_url="https://example.com",
            confidence="reported",
        ),
    ]
    out = private_marks(cos, vals, FX, date(2026, 10, 13))
    assert len(out) == 1
    assert out.iloc[0]["market_cap_usd"] == pytest.approx(22e9)
    assert out.iloc[0]["age_days"] == 11
