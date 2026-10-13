"""FX normalisation and market-cap derivation (pure pandas, no I/O)."""

from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.models import Company, PrivateValuation


def fx_lookup(fx: pd.DataFrame, currency: str, on: date) -> float | None:
    """USD per unit of `currency` on the latest FX date <= `on` (USD is always 1)."""
    if currency == "USD":
        return 1.0
    rows = fx[(fx["currency"] == currency) & (fx["date"] <= on)]
    if rows.empty:
        return None
    return float(rows.sort_values("date")["usd_per_unit"].iloc[-1])


def attach_fx(prices: pd.DataFrame, fx: pd.DataFrame) -> pd.DataFrame:
    """Add `fx_rate` (USD per listing-currency unit) to [company_id, ticker, date, close, currency].

    Uses the most recent FX observation on or before each price date, so a Seoul or Tokyo
    session on a US holiday still gets a rate. Rows with no prior FX keep NaN (checked later).
    """
    out = prices.copy()
    out["date"] = pd.to_datetime(out["date"])
    parts: list[pd.DataFrame] = []
    for ccy, unsorted in out.groupby("currency", sort=False):
        grp = unsorted.sort_values("date")
        if ccy == "USD":
            parts.append(grp.assign(fx_rate=1.0))
            continue
        rates = fx[fx["currency"] == ccy][["date", "usd_per_unit"]].copy()
        rates["date"] = pd.to_datetime(rates["date"])
        if rates.empty:
            parts.append(grp.assign(fx_rate=float("nan")))
            continue
        merged = pd.merge_asof(grp, rates.sort_values("date"), on="date", direction="backward")
        parts.append(merged.rename(columns={"usd_per_unit": "fx_rate"}))
    res = pd.concat(parts, ignore_index=True) if parts else out.assign(fx_rate=pd.Series(dtype=float))
    res["date"] = res["date"].dt.date
    return res.sort_values(["company_id", "date"]).reset_index(drop=True)


def market_caps(prices_fx: pd.DataFrame, shares: dict[str, float]) -> pd.DataFrame:
    """market_cap_usd = close x shares (listing units) x fx_rate."""
    out = prices_fx.copy()
    out["shares"] = out["company_id"].map(shares)
    out["market_cap_usd"] = out["close"] * out["shares"] * out["fx_rate"]
    return out


def latest_marks(caps: pd.DataFrame) -> pd.DataFrame:
    """One row per company: latest close/cap plus the previous session's cap for day change."""
    caps = caps.dropna(subset=["market_cap_usd"]).sort_values(["company_id", "date"])
    last = caps.groupby("company_id").tail(1).set_index("company_id")
    prev = caps.groupby("company_id").nth(-2).set_index("company_id")
    last["prev_market_cap_usd"] = prev["market_cap_usd"]
    last["prev_close"] = prev["close"]
    last["day_change_pct"] = last["close"] / last["prev_close"] - 1
    return last.reset_index()


def private_marks(
    companies: list[Company], valuations: list[PrivateValuation], fx: pd.DataFrame, as_of: date
) -> pd.DataFrame:
    """USD marks for private companies at their last disclosed round (FX at the round date)."""
    by_id = {v.company_id: v for v in valuations}
    rows = []
    for c in companies:
        if c.is_public or c.id not in by_id:
            continue
        v = by_id[c.id]
        rate = fx_lookup(fx, v.currency, v.as_of_date)
        rows.append(
            {
                "company_id": c.id,
                "market_cap_usd": v.valuation * rate if rate is not None else float("nan"),
                "valuation": v.valuation,
                "currency": v.currency,
                "fx_rate": rate,
                "as_of_date": v.as_of_date,
                "age_days": (as_of - v.as_of_date).days,
            }
        )
    return pd.DataFrame(
        rows, columns=["company_id", "market_cap_usd", "valuation", "currency", "fx_rate", "as_of_date", "age_days"]
    )
