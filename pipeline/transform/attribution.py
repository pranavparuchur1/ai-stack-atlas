"""Layer attribution: primary-layer totals (no double counting) and revenue-segment split."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from pipeline.frames import records
from pipeline.models import Layer, SegmentSplit

OUTSIDE = "other"  # pseudo-layer for revenue outside the AI stack


@dataclass(frozen=True)
class LayerTotals:
    primary: dict[str, float]
    segment: dict[str, float]
    outside_stack: float
    day_change: dict[str, float | None]


def segment_shares(
    company_ids: list[str], primary: dict[str, str], splits: list[SegmentSplit]
) -> dict[str, dict[str, float]]:
    """Share of each company's cap attributed to each layer; 100% primary when no split is curated."""
    by_id = {s.company_id: s.shares for s in splits}
    return {cid: dict(by_id.get(cid, {primary[cid]: 1.0})) for cid in company_ids}


def layer_totals(marks: pd.DataFrame, layers: list[Layer], shares: dict[str, dict[str, float]]) -> LayerTotals:
    """`marks` needs [company_id, primary_layer, market_cap_usd, prev_market_cap_usd]."""
    ids = [l.id for l in layers]
    primary = {lid: 0.0 for lid in ids}
    segment = {lid: 0.0 for lid in ids}
    outside = 0.0
    cur = {lid: 0.0 for lid in ids}
    prev = {lid: 0.0 for lid in ids}
    for r in records(marks):
        cap, layer = float(r["market_cap_usd"]), str(r["primary_layer"])
        primary[layer] += cap
        for lid, share in shares[str(r["company_id"])].items():
            if lid == OUTSIDE:
                outside += cap * share
            else:
                segment[lid] += cap * share
        prev_cap = r.get("prev_market_cap_usd")
        if prev_cap is not None and pd.notna(prev_cap) and float(prev_cap) > 0:
            cur[layer] += cap
            prev[layer] += float(prev_cap)
    change = {lid: (cur[lid] / prev[lid] - 1) if prev[lid] > 0 else None for lid in ids}
    return LayerTotals(primary=primary, segment=segment, outside_stack=outside, day_change=change)
