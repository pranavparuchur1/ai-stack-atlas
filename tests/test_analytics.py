from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from pipeline.transform.analytics import cap_weighted_index, compute, wide_caps


def _long(wide: pd.DataFrame) -> pd.DataFrame:
    return (
        wide.rename_axis("date").reset_index().melt(id_vars="date", var_name="company_id", value_name="market_cap_usd")
    )


def test_cap_weighted_index_uses_prior_day_weights() -> None:
    caps = pd.DataFrame({"a": [300.0, 330.0], "b": [100.0, 90.0]}, index=[1, 2])
    rets = caps.pct_change()
    idx = cap_weighted_index(rets, caps, {"L": ["a", "b"]})
    # weights 0.75 / 0.25 from day 1; returns +10% / -10% -> +5%
    assert idx.loc[2, "L"] == pytest.approx(0.75 * 0.10 + 0.25 * -0.10)
    # a cap-weighted index of a layer equals the change in the layer's total cap
    assert idx.loc[2, "L"] == pytest.approx(caps.loc[2].sum() / caps.loc[1].sum() - 1)


def test_wide_caps_drops_sparse_dates_and_ffills() -> None:
    d0 = date(2026, 1, 1)
    df = pd.DataFrame(
        {
            "date": [d0, d0, d0 + timedelta(1), d0 + timedelta(2), d0 + timedelta(2)],
            "company_id": ["a", "b", "a", "a", "b"],
            "market_cap_usd": [1.0, 2.0, 1.1, 1.2, 2.2],
        }
    )
    w = wide_caps(df, d0, min_coverage=0.5)
    assert list(w.index) == [d0, d0 + timedelta(1), d0 + timedelta(2)]
    assert w.loc[d0 + timedelta(1), "b"] == 2.0  # forward-filled


def test_compute_beta_corr_vol() -> None:
    rng = np.random.default_rng(0)
    days = pd.bdate_range("2025-10-01", periods=200).date
    m = rng.normal(0, 0.01, 200)
    a = 100 * np.cumprod(1 + m)  # moves 1:1 with market
    b = 50 * np.cumprod(1 + 2 * m)  # beta ~2
    c = 80 * np.cumprod(1 + rng.normal(0, 0.01, 200))  # independent, other layer
    wide = pd.DataFrame({"a": a, "b": b, "c": c}, index=days)
    res = compute(_long(wide), {"a": "L", "b": "L", "c": "M"}, days[0], vol_window=60)
    assert res.correlation.at["a", "b"] == pytest.approx(1.0, abs=1e-6)
    assert abs(res.correlation.at["a", "c"]) < 0.3
    # beta of b to an index of its own layer > beta of a (it is the more volatile member)
    assert res.beta.at["b", "L"] > res.beta.at["a", "L"]
    assert res.beta.at["c", "M"] == pytest.approx(1.0)
    assert res.vol["b"] == pytest.approx(2 * res.vol["a"], rel=0.05)
    assert res.layer_levels.iloc[0].tolist() == pytest.approx(
        [100 * (1 + res.layer_returns.iloc[0]["L"]), 100 * (1 + res.layer_returns.iloc[0]["M"])]
    )
    assert res.total_return["a"] == pytest.approx(a[-1] / a[0] - 1)
