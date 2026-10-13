from __future__ import annotations

from datetime import date
from typing import Any

import httpx
import pandas as pd
import pytest

from pipeline.extract import providers as prov
from pipeline.extract.providers import yfinance as yfp
from pipeline.extract.providers.base import is_us_listing
from pipeline.extract.providers.finnhub import FinnhubQuotes
from pipeline.extract.providers.polygon import PolygonQuotes


def _fake_download(symbols: list[str], **_: Any) -> pd.DataFrame:
    idx = pd.to_datetime(["2026-10-12", "2026-10-13"])
    cols = pd.MultiIndex.from_product([["Close", "Open"], symbols])
    data = [[1.0 + i for i in range(len(symbols))] * 2, [None] + [2.0] * (len(symbols) - 1) + [0.0] * len(symbols)]
    return pd.DataFrame(data, index=idx, columns=cols)


def test_yfinance_history_and_fx(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(yfp.yf, "download", _fake_download)
    p = yfp.YFinanceProvider()
    h = p.history(["NVDA", "AMD"], date(2026, 10, 12), date(2026, 10, 13))
    assert list(h.columns) == ["ticker", "date", "close"]
    assert len(h) == 3  # one NaN dropped
    fx = p.fx_history(["USD", "KRW", "EUR"], date(2026, 10, 12), date(2026, 10, 13))
    assert set(fx["currency"]) == {"EUR", "KRW"}
    assert p.fx_history(["USD"], date(2026, 1, 1), date(2026, 1, 2)).empty
    assert p.history([], date(2026, 1, 1), date(2026, 1, 2)).empty


def test_yfinance_empty_download(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(yfp.yf, "download", lambda *a, **k: pd.DataFrame())
    assert yfp.YFinanceProvider().history(["X"], date(2026, 1, 1), date(2026, 1, 2)).empty


def test_yfinance_fundamentals(monkeypatch: pytest.MonkeyPatch) -> None:
    infos = {
        "TSM": {"marketCap": 2_000.0, "currentPrice": 400.0, "totalRevenue": 4e12, "financialCurrency": "TWD"},
        "OLD": {"sharesOutstanding": 7.0, "currency": "USD"},
    }

    class T:
        def __init__(self, t: str) -> None:
            if t == "BOOM":
                raise RuntimeError("network")
            self.info = infos[t]

    monkeypatch.setattr(yfp.yf, "Ticker", T)
    f = yfp.YFinanceProvider().fundamentals(["TSM", "OLD", "BOOM"]).set_index("ticker")
    assert f.at["TSM", "shares"] == 5.0  # marketCap / price keeps listing units
    assert f.at["TSM", "revenue_currency"] == "TWD"
    assert f.at["OLD", "shares"] == 7.0 and pd.isna(f.at["OLD", "revenue_ttm"])
    assert "BOOM" not in f.index


def _client(handler: Any) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_finnhub_quotes() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["X-Finnhub-Token"] == "k"
        sym = req.url.params["symbol"]
        if sym == "BAD":
            return httpx.Response(500)
        if sym == "ZERO":
            return httpx.Response(200, json={"c": 0, "t": 0})
        return httpx.Response(200, json={"c": 123.4, "t": 1_760_000_000})

    q = FinnhubQuotes("k", _client(handler)).quotes(["NVDA", "BAD", "ZERO", "000660.KS"])
    assert [x.ticker for x in q] == ["NVDA"] and q[0].price == 123.4


def test_polygon_quotes() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if "BAD" in req.url.path:
            return httpx.Response(429)
        if "NONE" in req.url.path:
            return httpx.Response(200, json={"results": []})
        return httpx.Response(200, json={"results": [{"c": 10.5, "t": 1_760_000_000_000}]})

    q = PolygonQuotes("k", _client(handler)).quotes(["AMD", "BAD", "NONE", "SU.PA"])
    assert [(x.ticker, x.price) for x in q] == [("AMD", 10.5)]


def test_quote_providers_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.delenv("POLYGON_API_KEY", raising=False)
    assert prov.quote_providers(("finnhub", "polygon", "yfinance")) == []
    monkeypatch.setenv("POLYGON_API_KEY", "p")
    monkeypatch.setenv("FINNHUB_API_KEY", "f")
    assert [p.name for p in prov.quote_providers(("polygon", "finnhub"))] == ["polygon", "finnhub"]


@pytest.mark.parametrize(("t", "us"), [("NVDA", True), ("8035.T", False), ("KRWUSD=X", False)])
def test_is_us_listing(t: str, us: bool) -> None:
    assert is_us_listing(t) is us
