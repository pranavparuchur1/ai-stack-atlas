"""Orchestrates one pipeline run: extract -> load raw -> transform -> validate -> publish."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

import pandas as pd

from pipeline import __version__
from pipeline.config import Settings
from pipeline.extract.curated import load_curated, load_model_params
from pipeline.extract.providers.base import MarketDataProvider, QuoteProvider
from pipeline.frames import records
from pipeline.load.snapshot import build_analytics, build_prices, build_snapshot, write_json
from pipeline.load.warehouse import Warehouse
from pipeline.models import (
    BacktestEventSpec,
    Backtests,
    CheckResult,
    CheckStatus,
    Curated,
    Lineage,
    LineageNode,
    SourceInfo,
)
from pipeline.transform import analytics as an
from pipeline.transform.attribution import layer_totals, segment_shares
from pipeline.transform.backtest_inputs import build_backtests, load_events
from pipeline.transform.market_cap import attach_fx, fx_lookup, latest_marks, market_caps, private_marks
from pipeline.validate import checks as ck

log = logging.getLogger("pipeline")


@dataclass
class RunReport:
    run_id: str
    status: str
    checks: list[CheckResult]
    row_counts: dict[str, int]
    outputs: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status != "failed"


def _extract_market_data(
    wh: Warehouse, cur: Curated, provider: MarketDataProvider, quotes: list[QuoteProvider], st: Settings, today: date
) -> list[SourceInfo]:
    """Incrementally pull bars, quotes, FX and fundamentals into the warehouse."""
    public = [c for c in cur.companies if c.is_public and c.ticker]
    tickers = [c.ticker for c in public if c.ticker]
    cold = today - timedelta(days=st.history_days)
    have = wh.max_dates()
    starts = [have[t] - timedelta(days=st.refetch_overlap_days) if t in have else cold for t in tickers]
    start = max(min(starts), cold) if starts else cold
    now = datetime.now(UTC).replace(tzinfo=None)

    bars = provider.history(tickers, start, today)
    n_bars = wh.upsert("raw_prices", bars.assign(source=provider.name, loaded_at=now))
    sources = [
        SourceInfo(name=f"{provider.name} daily bars", kind="prices", records=n_bars, detail=f"{start}..{today}")
    ]

    for qp in quotes:  # optional fresher quotes for US listings, overwriting today's bar
        got = qp.quotes(tickers)
        df = pd.DataFrame(
            [
                {"ticker": q.ticker, "date": q.ts.date(), "close": q.price, "source": qp.name, "loaded_at": now}
                for q in got
            ]
        )
        sources.append(SourceInfo(name=f"{qp.name} quotes", kind="quotes", records=wh.upsert("raw_prices", df)))

    funds = pd.DataFrame()
    if not wh.has_fundamentals_for(today):
        funds = provider.fundamentals(tickers)
    ccys = {c.currency for c in public} | {v.currency for v in cur.private_valuations}
    if not funds.empty:
        ccys |= set(funds["revenue_currency"].dropna())
    fx_start = min([start, *(v.as_of_date for v in cur.private_valuations if v.currency != "USD")])
    fx_start = min(fx_start, cold) if not have else fx_start
    fx = provider.fx_history(sorted(ccys), fx_start - timedelta(days=7), today)
    sources.append(
        SourceInfo(
            name=f"{provider.name} FX", kind="fx", records=wh.upsert("fx_rates", fx.assign(source=provider.name))
        )
    )

    if not funds.empty:
        all_fx = wh.fx_since(today - timedelta(days=30))
        tick_to_id = {c.ticker: c.id for c in public}
        rev_usd: list[float | None] = [
            float(r["revenue_ttm"]) * (fx_lookup(all_fx, str(r["revenue_currency"]), today) or float("nan"))
            if pd.notna(r["revenue_ttm"]) and r["revenue_currency"]
            else None
            for r in records(funds)
        ]
        funds = funds.assign(company_id=funds["ticker"].map(tick_to_id), as_of=today, source=provider.name)
        funds["revenue_ttm_usd"] = pd.Series(rev_usd, index=funds.index, dtype=float)
        funds = funds.drop(columns=["ticker"])
        sources.append(
            SourceInfo(
                name=f"{provider.name} fundamentals", kind="fundamentals", records=wh.upsert("fundamentals", funds)
            )
        )
    return sources


def run_pipeline(
    st: Settings,
    provider: MarketDataProvider,
    quotes: list[QuoteProvider] | None = None,
    today: date | None = None,
) -> RunReport:
    t0 = time.monotonic()
    started = datetime.now(UTC)
    today = today or started.date()
    run_id = started.strftime("%Y%m%dT%H%M%SZ")
    cur = load_curated(st.data_dir)
    wh = Warehouse(st.warehouse)
    try:
        counts = wh.load_curated(cur)
        sources = [
            SourceInfo(
                name="curated YAML",
                kind="curated",
                records=sum(counts.values()),
                detail=", ".join(f"{k}={v}" for k, v in counts.items()),
            )
        ]
        sources += _extract_market_data(wh, cur, provider, quotes or [], st, today)

        # ---------------------------------------------------------- transform
        window_start = today - timedelta(days=st.history_days)
        raw = wh.raw_prices_since(window_start)
        fx = wh.fx_since(min([window_start] + [v.as_of_date for v in cur.private_valuations]) - timedelta(days=7))
        funds = wh.latest_fundamentals()

        public = [c for c in cur.companies if c.is_public]
        meta = pd.DataFrame([{"company_id": c.id, "ticker": c.ticker, "currency": c.currency} for c in public])
        prices = raw.merge(meta, on="ticker", how="inner")
        prices_fx = attach_fx(prices, fx)
        shares = dict(zip(funds["company_id"], funds["shares"], strict=True))
        caps = market_caps(prices_fx, shares)
        wh.upsert(
            "prices",
            caps.rename(columns={"date": "ts", "close": "price", "currency": "price_ccy"})
            .assign(granularity="daily")[
                ["company_id", "ts", "price", "price_ccy", "fx_rate", "market_cap_usd", "source", "granularity"]
            ]
            .dropna(subset=["market_cap_usd"]),
        )

        latest = latest_marks(caps).rename(columns={"date": "price_date"})
        latest = latest.merge(funds[["company_id", "revenue_ttm_usd"]], on="company_id", how="left")
        as_of = max(latest["price_date"]) if not latest.empty else today
        priv = private_marks(cur.companies, cur.private_valuations, fx, as_of).assign(source="private_valuations.yaml")
        marks = pd.concat([latest, priv], ignore_index=True)
        info = pd.DataFrame(
            [{"company_id": c.id, "primary_layer": c.primary_layer, "is_public": c.is_public} for c in cur.companies]
        )
        marks = info.merge(marks, on="company_id", how="left")

        primary = {c.id: c.primary_layer for c in cur.companies}
        seg = segment_shares([c.id for c in cur.companies], primary, cur.segments)
        totals = layer_totals(marks.dropna(subset=["market_cap_usd"]), cur.layers, seg)

        res = an.compute(caps, primary, today - timedelta(days=st.analytics_window_days), st.vol_window)

        # ---------------------------------------------------------- validate
        required_ccy = {c.currency for c in public}
        results = [
            *ck.curated_checks(cur, today, st.checks),
            ck.frame_schemas(raw[["ticker", "date", "close"]], fx, marks),
            ck.no_negative_market_caps(marks),
            ck.every_company_marked(marks, cur),
            ck.fx_present(prices_fx, required_ccy, fx),
            ck.prices_fresh(marks[marks["is_public"]].dropna(subset=["price_date"]), today, st.checks.price_stale_days),
            ck.no_implausible_jumps(marks, st.checks.max_daily_cap_jump),
            ck.layer_totals_reconcile(marks.dropna(subset=["market_cap_usd"]), totals, st.checks.reconcile_tolerance),
        ]
        status = ck.summarize(results)
        row_counts = {
            t: wh.count(t)
            for t in (
                "companies",
                "edges",
                "private_valuations",
                "segments",
                "raw_prices",
                "prices",
                "fx_rates",
                "fundamentals",
            )
        }

        # ---------------------------------------------------------- publish
        outputs: list[str] = []
        finished = datetime.now(UTC)
        if status != "failed":
            snap = build_snapshot(cur, marks, totals, seg, run_id, finished, as_of)
            cap_by_id = {str(r["company_id"]): float(r["market_cap_usd"]) for r in records(marks)}
            layer_order = {l.id: l.order for l in cur.layers}
            order = [
                c.id for c in sorted(cur.companies, key=lambda c: (layer_order[c.primary_layer], -cap_by_id[c.id]))
            ]
            layer_ids = [l.id for l in sorted(cur.layers, key=lambda l: l.order)]
            closes = prices_fx.pivot_table(index="date", columns="company_id", values="close")
            files = {
                "snapshot_latest.json": snap,
                f"history/{as_of.isoformat()}.json": snap,
                "analytics.json": build_analytics(res, order, layer_ids),
                "prices_1y.json": build_prices(res, closes),
            }
            files["model.json"] = load_model_params(st.config_dir / "model.yaml")
            bt = _backtests(st, cur, provider, funds, today, wh)
            if bt is not None:
                files["backtests.json"] = bt
            for name, model in files.items():
                write_json(st.out_dir / name, model)
                outputs.append(name)

        wh.record_run(
            {
                "run_id": run_id,
                "started_at": started.replace(tzinfo=None),
                "finished_at": finished.replace(tzinfo=None),
                "status": status,
                "as_of": as_of,
                "row_counts": row_counts,
                "check_results": [r.model_dump(mode="json") for r in results],
            }
        )
        lineage = _lineage(
            run_id,
            status,
            started,
            finished,
            time.monotonic() - t0,
            as_of,
            sources,
            row_counts,
            results,
            [*outputs, "lineage.json"],
            wh,
        )
        write_json(st.out_dir / "lineage.json", lineage)
        return RunReport(run_id=run_id, status=status, checks=results, row_counts=row_counts, outputs=outputs)
    finally:
        wh.close()


def _store_events(wh: Warehouse, specs: list[BacktestEventSpec]) -> None:
    """Saved scenarios live in the warehouse `events` table (the curated backtest events seed it)."""
    wh.replace_all(
        "events",
        pd.DataFrame(
            [
                {
                    "id": s.id,
                    "name": s.name,
                    "type": s.scenario.type.value,
                    "params": s.scenario.model_dump_json(exclude_none=True),
                    "created_at": pd.Timestamp(s.date),
                }
                for s in specs
            ]
        ),
    )


def _backtests(
    st: Settings, cur: Curated, provider: MarketDataProvider, funds: pd.DataFrame, today: date, wh: Warehouse
) -> Backtests | None:
    """Historical inputs are static, so they are rebuilt only when backtest_events.yaml changes."""
    spec_path = st.data_dir / "backtest_events.yaml"
    if not spec_path.exists():
        return None
    specs, spec_hash = load_events(spec_path)
    _store_events(wh, specs)
    out = st.out_dir / "backtests.json"
    if out.exists():
        try:
            if json.loads(out.read_text(encoding="utf-8")).get("spec_hash") == spec_hash:
                return None
        except ValueError:
            pass
    shares = {str(r["company_id"]): float(r["shares"]) for r in records(funds) if pd.notna(r["shares"])}
    revenue = {
        str(r["company_id"]): (float(r["revenue_ttm_usd"]) if pd.notna(r["revenue_ttm_usd"]) else None)
        for r in records(funds)
    }
    return build_backtests(specs, spec_hash, cur, provider, shares, revenue, today)


def _lineage(
    run_id: str,
    status: str,
    started: datetime,
    finished: datetime,
    duration: float,
    as_of: date | None,
    sources: list[SourceInfo],
    rows: dict[str, int],
    results: list[CheckResult],
    outputs: list[str],
    wh: Warehouse,
) -> Lineage:
    src_nodes = [
        LineageNode(id=f"src:{s.kind}:{i}", label=s.name, kind="source", rows=s.records) for i, s in enumerate(sources)
    ]
    steps = [
        LineageNode(
            id="t:raw",
            label="raw_prices / fx_rates / fundamentals (DuckDB)",
            kind="transform",
            rows=rows.get("raw_prices"),
        ),
        LineageNode(id="t:fx", label="FX-normalise to USD", kind="transform"),
        LineageNode(id="t:cap", label="market caps (close x shares x FX)", kind="transform", rows=rows.get("prices")),
        LineageNode(id="t:attr", label="layer attribution (primary / segment)", kind="transform"),
        LineageNode(id="t:an", label="analytics (indices, corr, beta, vol)", kind="transform"),
        LineageNode(id="chk", label=f"{len(results)} quality checks", kind="check"),
    ]
    out_nodes = [LineageNode(id=f"out:{o}", label=o, kind="output") for o in outputs]
    links = [(n.id, "t:raw") for n in src_nodes if n.label != "curated YAML"]
    links += [
        (src_nodes[0].id, "t:attr"),
        ("t:raw", "t:fx"),
        ("t:fx", "t:cap"),
        ("t:cap", "t:attr"),
        ("t:cap", "t:an"),
        ("t:attr", "chk"),
        ("t:an", "chk"),
    ]
    links += [("chk", n.id) for n in out_nodes]
    hist = [
        {
            "run_id": str(r["run_id"]),
            "status": str(r["status"]),
            "started_at": pd.Timestamp(r["started_at"]).isoformat(),
            "duration_s": round((pd.Timestamp(r["finished_at"]) - pd.Timestamp(r["started_at"])).total_seconds(), 1),
        }
        for r in records(wh.recent_runs())
    ]
    return Lineage(
        run_id=run_id,
        status=status,
        started_at=started,
        finished_at=finished,
        duration_s=round(duration, 2),
        as_of=as_of,
        pipeline_version=__version__,
        sources=sources,
        row_counts=rows,
        checks=results,
        nodes=src_nodes + steps + out_nodes,
        links=links,
        outputs=outputs,
        history=hist,
    )


def failed(results: list[CheckResult]) -> list[CheckResult]:
    return [r for r in results if r.status is CheckStatus.fail]
