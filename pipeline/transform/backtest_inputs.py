"""Inputs for historical backtests: pre-event caps and market-adjusted returns.

The propagation engine itself lives in the web app (one implementation); the pipeline only
prepares what it needs to replay an event without look-ahead:
  * edges whose evidence_date <= event date,
  * market caps at the close before the effective date (current share counts - documented limitation),
  * returns over 1/3/5 sessions from that close, minus the benchmark's return over the same sessions.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pandas as pd
import yaml

from pipeline.extract.providers.base import MarketDataProvider
from pipeline.models import BacktestCompany, BacktestEvent, BacktestEventSpec, Backtests, Curated
from pipeline.transform.market_cap import fx_lookup

BENCHMARK = "SPY"
WINDOWS = (1, 3, 5)


def load_events(path: Path) -> tuple[list[BacktestEventSpec], str]:
    raw = path.read_text(encoding="utf-8")
    events = [BacktestEventSpec(**e) for e in (yaml.safe_load(raw) or {}).get("events", [])]
    return events, hashlib.sha256(raw.encode()).hexdigest()[:16]


def window_returns(
    series: pd.Series, t0: date, windows: tuple[int, ...] = WINDOWS
) -> tuple[float | None, dict[str, float | None]]:
    """Base = last close before t0; return to the k-th session on/after t0, for each k."""
    s = series.dropna().sort_index()
    before = s[s.index < t0]
    after = s[s.index >= t0]
    if before.empty:
        return None, {str(k): None for k in windows}
    base = float(before.iloc[-1])
    return base, {str(k): (float(after.iloc[k - 1]) / base - 1) if len(after) >= k else None for k in windows}


def build_backtests(
    specs: list[BacktestEventSpec],
    spec_hash: str,
    cur: Curated,
    provider: MarketDataProvider,
    shares: dict[str, float],
    revenue: dict[str, float | None],
    today: date,
) -> Backtests:
    public = [c for c in cur.companies if c.is_public and c.ticker]
    by_ticker = {c.ticker: c for c in public if c.ticker}
    out: list[BacktestEvent] = []
    for ev in specs:
        start, end = ev.effective_date - timedelta(days=14), min(today, ev.effective_date + timedelta(days=14))
        bars = provider.history([*by_ticker, BENCHMARK], start, end)
        fx = provider.fx_history(sorted({c.currency for c in public}), start - timedelta(days=7), end)
        wide = bars.pivot_table(index="date", columns="ticker", values="close")
        bench: dict[str, float | None] = {}
        if BENCHMARK in wide:
            _, bench = window_returns(wide[BENCHMARK], ev.effective_date)
        rows: list[BacktestCompany] = []
        for t, c in by_ticker.items():
            if t not in wide or c.id not in shares:
                continue
            base, rets = window_returns(wide[t], ev.effective_date)
            rate = fx_lookup(fx, c.currency, ev.effective_date - timedelta(days=1))
            if base is None or rate is None:
                continue
            adj = {k: (r - b) if r is not None and (b := bench.get(k)) is not None else None for k, r in rets.items()}
            rows.append(BacktestCompany(id=c.id, cap_before=base * shares[c.id] * rate, actual=adj))
        # private companies at the last valuation known on the event date; the shocked company at its prior mark
        for v in cur.private_valuations:
            if v.company_id == ev.scenario.company_id:
                if ev.scenario.prior_valuation_usd:
                    rows.append(BacktestCompany(id=v.company_id, cap_before=ev.scenario.prior_valuation_usd, actual={}))
            elif v.as_of_date <= ev.date:
                rate = 1.0 if v.currency == "USD" else fx_lookup(fx, v.currency, v.as_of_date)
                if rate:
                    rows.append(BacktestCompany(id=v.company_id, cap_before=v.valuation * rate, actual={}))
        edge_ids = [
            f"{e.source_id}-{e.target_id}-{e.relation_type.value}" for e in cur.edges if e.evidence_date <= ev.date
        ]
        out.append(
            BacktestEvent(
                **ev.model_dump(exclude={"source_url", "prior_source_url"}),
                source_url=str(ev.source_url),
                prior_source_url=str(ev.prior_source_url) if ev.prior_source_url else None,
                companies=rows,
                edge_ids=edge_ids,
                revenue={r.id: revenue.get(r.id) for r in rows},
            )
        )
    return Backtests(
        generated_at=datetime.now(UTC), spec_hash=spec_hash, benchmark=BENCHMARK, windows=list(WINDOWS), events=out
    )
