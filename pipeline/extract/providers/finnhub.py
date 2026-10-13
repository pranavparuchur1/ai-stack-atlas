"""Finnhub REST quotes (optional; requires FINNHUB_API_KEY). US listings only on the free tier."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import UTC, datetime

import httpx

from pipeline.extract.providers.base import Quote, is_us_listing

log = logging.getLogger(__name__)


class FinnhubQuotes:
    name = "finnhub"
    url = "https://finnhub.io/api/v1/quote"

    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        self._key = api_key
        self._client = client or httpx.Client(timeout=10)

    def quotes(self, tickers: Sequence[str]) -> list[Quote]:
        out: list[Quote] = []
        for t in tickers:
            if not is_us_listing(t):
                continue
            try:
                r = self._client.get(self.url, params={"symbol": t}, headers={"X-Finnhub-Token": self._key})
                r.raise_for_status()
                body = r.json()
            except (httpx.HTTPError, ValueError) as exc:
                log.warning("finnhub quote failed for %s: %s", t, exc)
                continue
            price, ts = body.get("c"), body.get("t")
            if price and ts:  # Finnhub returns c=0 for unknown symbols
                out.append(Quote(t, float(price), datetime.fromtimestamp(int(ts), tz=UTC)))
        return out
