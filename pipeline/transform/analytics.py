"""Return analytics on USD market caps: layer indices, correlation, beta, volatility.

All series are USD market-cap returns (price return x FX), so a KRW listing's FX move is
part of its return - the view of a USD-based investor. Dividends are ignored.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

TRADING_DAYS = 252


@dataclass(frozen=True)
class AnalyticsResult:
    dates: list[date]
    caps: pd.DataFrame  # date x company, USD
    returns: pd.DataFrame  # date x company
    layer_returns: pd.DataFrame  # date x layer
    layer_levels: pd.DataFrame  # date x layer, base 100
    correlation: pd.DataFrame
    beta: pd.DataFrame  # company x layer
    vol: pd.Series
    layer_vol: pd.Series
    total_return: pd.Series
    layer_total_return: pd.Series
    layer_correlation: pd.DataFrame
    corr_to_layer: pd.DataFrame  # company x layer


def wide_caps(caps: pd.DataFrame, start: date, min_coverage: float = 0.5) -> pd.DataFrame:
    """Pivot to date x company; keep dates where >= min_coverage of companies traded; ffill gaps <= 3 days."""
    w = caps[caps["date"] >= start].pivot_table(index="date", columns="company_id", values="market_cap_usd")
    w = w.sort_index()
    w = w[w.notna().mean(axis=1) >= min_coverage]
    return w.ffill(limit=3)


def cap_weighted_index(returns: pd.DataFrame, caps: pd.DataFrame, members: dict[str, list[str]]) -> pd.DataFrame:
    """Layer index return r_L,t = sum_i w_i,t-1 * r_i,t with w from the prior day's caps."""
    weights_base = caps.shift(1)
    out = {}
    for layer, member_ids in members.items():
        ids = [i for i in member_ids if i in returns.columns]
        if not ids:
            continue
        r, w = returns[ids], weights_base[ids].where(returns[ids].notna())
        out[layer] = (r * w).sum(axis=1, min_count=1) / w.sum(axis=1, min_count=1)
    return pd.DataFrame(out, index=returns.index)


def _beta(x: pd.Series, m: pd.Series, min_obs: int = 60) -> float | None:
    ok = x.notna() & m.notna()
    if ok.sum() < min_obs:
        return None
    var = m[ok].var()
    return float(x[ok].cov(m[ok]) / var) if var > 0 else None


def _corr(x: pd.Series, m: pd.Series, min_obs: int = 60) -> float | None:
    ok = x.notna() & m.notna()
    if ok.sum() < min_obs:
        return None
    c = x[ok].corr(m[ok])
    return None if pd.isna(c) else float(c)


def compute(caps: pd.DataFrame, primary: dict[str, str], start: date, vol_window: int = 60) -> AnalyticsResult:
    w = wide_caps(caps, start)
    members: dict[str, list[str]] = {}
    for cid in w.columns:
        members.setdefault(primary[cid], []).append(cid)
    all_rets = w.pct_change(fill_method=None)
    rets = all_rets.iloc[1:]
    layer_r = cap_weighted_index(all_rets, w, members).iloc[1:]
    levels = 100 * (1 + layer_r.fillna(0)).cumprod()
    corr = rets.corr(min_periods=60)
    beta = pd.DataFrame({lid: {cid: _beta(rets[cid], layer_r[lid]) for cid in rets.columns} for lid in layer_r.columns})
    ann = math.sqrt(TRADING_DAYS)
    vol = rets.rolling(vol_window, min_periods=vol_window).std().iloc[-1] * ann if len(rets) else pd.Series(dtype=float)
    layer_vol = (
        layer_r.rolling(vol_window, min_periods=vol_window).std().iloc[-1] * ann
        if len(layer_r)
        else pd.Series(dtype=float)
    )
    first = w.apply(lambda s: s.dropna().iloc[0] if s.notna().any() else np.nan)
    last = w.apply(lambda s: s.dropna().iloc[-1] if s.notna().any() else np.nan)
    return AnalyticsResult(
        dates=list(w.index),
        caps=w,
        returns=rets,
        layer_returns=layer_r,
        layer_levels=levels,
        correlation=corr,
        beta=beta,
        vol=vol,
        layer_vol=layer_vol,
        total_return=last / first - 1,
        layer_total_return=levels.iloc[-1] / 100 - 1 if len(levels) else pd.Series(dtype=float),
        layer_correlation=layer_r.corr(min_periods=60),
        corr_to_layer=pd.DataFrame(
            {lid: {cid: _corr(rets[cid], layer_r[lid]) for cid in rets.columns} for lid in layer_r.columns}
        ),
    )
