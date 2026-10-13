"""Market-data providers behind small Protocols so tests can swap in a fake."""

from __future__ import annotations

import os

from pipeline.extract.providers.base import MarketDataProvider, QuoteProvider
from pipeline.extract.providers.finnhub import FinnhubQuotes
from pipeline.extract.providers.polygon import PolygonQuotes


def quote_providers(order: tuple[str, ...]) -> list[QuoteProvider]:
    """Keyed quote providers, in configured order, that have an API key in the environment."""
    out: list[QuoteProvider] = []
    for name in order:
        if name == "finnhub" and os.environ.get("FINNHUB_API_KEY"):
            out.append(FinnhubQuotes(os.environ["FINNHUB_API_KEY"]))
        elif name == "polygon" and os.environ.get("POLYGON_API_KEY"):
            out.append(PolygonQuotes(os.environ["POLYGON_API_KEY"]))
    return out


__all__ = ["MarketDataProvider", "QuoteProvider", "quote_providers"]
