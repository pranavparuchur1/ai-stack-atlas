"""Provider interfaces and the frame shapes they return."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

import pandas as pd

# history():       columns [ticker, date, close]          (close in the listing currency)
# fx_history():    columns [currency, date, usd_per_unit]
# fundamentals():  columns [ticker, shares, revenue_ttm, revenue_currency]
HISTORY_COLUMNS = ["ticker", "date", "close"]
FX_COLUMNS = ["currency", "date", "usd_per_unit"]
FUNDAMENTAL_COLUMNS = ["ticker", "shares", "revenue_ttm", "revenue_currency"]


class MarketDataProvider(Protocol):
    name: str

    def history(self, tickers: Sequence[str], start: date, end: date) -> pd.DataFrame: ...

    def fx_history(self, currencies: Sequence[str], start: date, end: date) -> pd.DataFrame: ...

    def fundamentals(self, tickers: Sequence[str]) -> pd.DataFrame: ...


@dataclass(frozen=True)
class Quote:
    ticker: str
    price: float
    ts: datetime


class QuoteProvider(Protocol):
    name: str

    def quotes(self, tickers: Sequence[str]) -> list[Quote]: ...


def is_us_listing(ticker: str) -> bool:
    """US tickers in yfinance convention carry no exchange suffix (e.g. NVDA vs 8035.T)."""
    return "." not in ticker and "=" not in ticker
