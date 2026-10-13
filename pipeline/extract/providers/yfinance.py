"""yfinance provider: daily bars, FX and fundamentals with no API key.

Shares are derived as `marketCap / currentPrice` from Yahoo's quote summary, which keeps
them in the *listing's* units: ADR-equivalent for TSM, all share classes for GOOGL/SPCX.
Market cap is then close x shares x FX for every day in the window. This assumes a
constant share count over the window (documented limitation: buybacks/issuance drift).
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import date, timedelta
from typing import Any, cast

import pandas as pd
import yfinance as yf

from pipeline.extract.providers.base import FUNDAMENTAL_COLUMNS, FX_COLUMNS, HISTORY_COLUMNS

log = logging.getLogger(__name__)


def _download_close(symbols: Sequence[str], start: date, end: date) -> pd.DataFrame:
    """Wide frame of closes (index=date, columns=symbol). `end` is inclusive."""
    raw = yf.download(
        list(symbols),
        start=start.isoformat(),
        end=(end + timedelta(days=1)).isoformat(),
        auto_adjust=False,
        progress=False,
        threads=True,
        group_by="column",
    )
    if raw is None or raw.empty:
        return pd.DataFrame()
    close = raw["Close"]
    if isinstance(close, pd.Series):  # single symbol
        close = close.to_frame(name=symbols[0])
    close.index = pd.to_datetime(close.index).date
    return cast(pd.DataFrame, close)


def _melt(wide: pd.DataFrame, key: str, value: str) -> pd.DataFrame:
    if wide.empty:
        return pd.DataFrame(columns=[key, "date", value])
    long = wide.rename_axis("date").reset_index().melt(id_vars="date", var_name=key, value_name=value)
    return long.dropna(subset=[value])[[key, "date", value]]


class YFinanceProvider:
    name = "yfinance"

    def history(self, tickers: Sequence[str], start: date, end: date) -> pd.DataFrame:
        if not tickers:
            return pd.DataFrame(columns=HISTORY_COLUMNS)
        return _melt(_download_close(tickers, start, end), "ticker", "close")[HISTORY_COLUMNS]

    def fx_history(self, currencies: Sequence[str], start: date, end: date) -> pd.DataFrame:
        foreign = sorted({c for c in currencies if c != "USD"})
        if not foreign:
            return pd.DataFrame(columns=FX_COLUMNS)
        wide = _download_close([f"{c}USD=X" for c in foreign], start, end)
        wide.columns = [str(c).removesuffix("USD=X") for c in wide.columns]
        return _melt(wide, "currency", "usd_per_unit")[FX_COLUMNS]

    def fundamentals(self, tickers: Sequence[str]) -> pd.DataFrame:
        rows: list[dict[str, Any]] = []
        for t in tickers:
            try:
                info = yf.Ticker(t).info or {}
            except Exception as exc:  # network / parsing failures are per-ticker, not fatal
                log.warning("fundamentals failed for %s: %s", t, exc)
                continue
            cap, px = info.get("marketCap"), info.get("currentPrice") or info.get("regularMarketPrice")
            shares = cap / px if cap and px else info.get("sharesOutstanding")
            rows.append(
                {
                    "ticker": t,
                    "shares": float(shares) if shares else None,
                    "revenue_ttm": float(info["totalRevenue"]) if info.get("totalRevenue") else None,
                    "revenue_currency": info.get("financialCurrency") or info.get("currency"),
                }
            )
        return pd.DataFrame(rows, columns=FUNDAMENTAL_COLUMNS)
