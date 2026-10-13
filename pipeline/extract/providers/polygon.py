"""Polygon previous-close quotes (optional; requires POLYGON_API_KEY). US listings only."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import UTC, datetime

import httpx

from pipeline.extract.providers.base import Quote, is_us_listing

log = logging.getLogger(__name__)


class PolygonQuotes:
    name = "polygon"
    url = "https://api.polygon.io/v2/aggs/ticker/{ticker}/prev"

    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        self._key = api_key
        self._client = client or httpx.Client(timeout=10)

    def quotes(self, tickers: Sequence[str]) -> list[Quote]:
        out: list[Quote] = []
        for t in tickers:
            if not is_us_listing(t):
                continue
            try:
                r = self._client.get(self.url.format(ticker=t), params={"apiKey": self._key})
                r.raise_for_status()
                results = r.json().get("results") or []
            except (httpx.HTTPError, ValueError) as exc:
                log.warning("polygon quote failed for %s: %s", t, exc)
                continue
            if results:
                bar = results[0]
                out.append(Quote(t, float(bar["c"]), datetime.fromtimestamp(bar["t"] / 1000, tz=UTC)))
        return out
