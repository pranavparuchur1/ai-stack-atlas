"""Assemble the JSON outputs the web app reads, and write them atomically."""

from __future__ import annotations

import json
import math
import os
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd
from pydantic import BaseModel

from pipeline.frames import records
from pipeline.models import (
    Analytics,
    Curated,
    LayerIndexSeries,
    PriceSeries,
    Snapshot,
    SnapshotCompany,
    SnapshotEdge,
    SnapshotLayer,
    Valuation,
)
from pipeline.transform.analytics import AnalyticsResult
from pipeline.transform.attribution import LayerTotals


def sig(x: Any, digits: int = 6) -> float | None:
    """Round to `digits` significant figures; NaN/None -> None (JSON null)."""
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    if f == 0:
        return 0.0
    return round(f, digits - 1 - math.floor(math.log10(abs(f))))


def _opt_date(v: Any) -> date | None:
    if v is None or (isinstance(v, float) and math.isnan(v)) or v is pd.NaT:
        return None
    return pd.Timestamp(v).date()


def build_snapshot(
    cur: Curated,
    marks: pd.DataFrame,
    totals: LayerTotals,
    shares: dict[str, dict[str, float]],
    run_id: str,
    generated_at: datetime,
    as_of: date,
) -> Snapshot:
    m = marks.set_index("company_id")
    cap = {str(r["company_id"]): float(r["market_cap_usd"]) for r in records(marks)}
    vals = {v.company_id: v for v in cur.private_valuations}
    companies: list[SnapshotCompany] = []
    for c in cur.companies:
        r = m.loc[c.id]
        valuation = None
        if not c.is_public and c.id in vals:
            v = vals[c.id]
            valuation = Valuation(
                valuation_usd=cap[c.id],
                valuation=v.valuation,
                currency=v.currency,
                as_of_date=v.as_of_date,
                round=v.round,
                source_url=str(v.source_url),
                confidence=v.confidence,
                age_days=(as_of - v.as_of_date).days,
            )
        companies.append(
            SnapshotCompany(
                **c.model_dump(),
                market_cap_usd=cap[c.id],
                price=sig(r.get("close")) if c.is_public else None,
                price_date=_opt_date(r.get("price_date")) if c.is_public else None,
                day_change_pct=sig(r.get("day_change_pct"), 5) if c.is_public else None,
                fx_usd_per_unit=sig(r.get("fx_rate")),
                shares=sig(r.get("shares"), 8) if c.is_public else None,
                revenue_ttm_usd=sig(r.get("revenue_ttm_usd")),
                source=str(r.get("source") or ("private_valuations.yaml" if not c.is_public else "yfinance")),
                valuation=valuation,
                segments=shares[c.id],
            )
        )
    counts = marks.groupby("primary_layer").size().to_dict()
    pub_counts = marks[marks["is_public"]].groupby("primary_layer").size().to_dict()
    layers = [
        SnapshotLayer(
            **l.model_dump(),
            total_primary_usd=totals.primary[l.id],
            total_segment_usd=totals.segment[l.id],
            day_change_pct=sig(totals.day_change[l.id], 5),
            company_count=int(counts.get(l.id, 0)),
            public_count=int(pub_counts.get(l.id, 0)),
        )
        for l in sorted(cur.layers, key=lambda x: x.order)
    ]
    edges = [
        SnapshotEdge(id=f"{e.source_id}-{e.target_id}-{e.relation_type.value}", **e.model_dump(mode="json"))
        for e in cur.edges
    ]
    return Snapshot(
        run_id=run_id,
        generated_at=generated_at,
        as_of=as_of,
        total_market_cap_usd=float(marks["market_cap_usd"].sum()),
        outside_stack_segment_usd=totals.outside_stack,
        layers=layers,
        companies=companies,
        edges=edges,
    )


def _matrix(df: pd.DataFrame, ids: list[str]) -> list[list[float | None]]:
    d = df.reindex(index=ids, columns=ids)
    return [[sig(v, 4) for v in row] for row in d.to_numpy()]


def build_analytics(res: AnalyticsResult, order: list[str], layer_ids: list[str]) -> Analytics:
    ids = [i for i in order if i in res.returns.columns]
    lids = [l for l in layer_ids if l in res.layer_levels.columns]
    return Analytics(
        as_of=res.dates[-1],
        window_start=res.dates[0],
        company_ids=ids,
        correlation=_matrix(res.correlation, ids),
        layer_index=LayerIndexSeries(
            dates=list(res.layer_levels.index),
            levels={l: [sig(v, 6) or 0.0 for v in res.layer_levels[l]] for l in lids},
            day_returns={l: [sig(v, 4) or 0.0 for v in res.layer_returns[l].fillna(0)] for l in lids},
        ),
        beta={cid: {l: sig(res.beta.at[cid, l], 4) for l in lids} for cid in ids},
        layer_correlation={a: {b: sig(res.layer_correlation.at[a, b], 4) for b in lids} for a in lids},
        vol_60d={cid: sig(res.vol.get(cid), 4) for cid in ids},
        layer_vol_60d={l: sig(res.layer_vol.get(l), 4) for l in lids},
        return_1y={cid: sig(res.total_return.get(cid), 4) for cid in ids},
        layer_return_1y={l: sig(res.layer_total_return.get(l), 4) for l in lids},
    )


def build_prices(res: AnalyticsResult, closes: pd.DataFrame) -> PriceSeries:
    """Daily close (listing currency) and USD market cap per public company over the window."""
    idx = res.caps.index
    c = closes.reindex(idx)
    return PriceSeries(
        dates=list(idx),
        price={cid: [sig(v, 6) for v in c[cid]] for cid in c.columns if cid in res.caps.columns},
        market_cap_usd={cid: [sig(v, 5) for v in res.caps[cid]] for cid in res.caps.columns},
    )


def write_json(path: Path, model: BaseModel | dict[str, Any]) -> None:
    """Write via a temp file + os.replace so readers never see a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = model.model_dump_json() if isinstance(model, BaseModel) else json.dumps(model)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
