from __future__ import annotations

import pandas as pd
import pytest

from pipeline.models import Layer, SegmentSplit
from pipeline.transform.attribution import layer_totals, segment_shares

LAYERS = [Layer(id=i, name=i, short=i, order=n, group=str(n), accent=i) for n, i in enumerate(["cloud", "apps"], 1)]


def test_primary_vs_segment_attribution() -> None:
    marks = pd.DataFrame(
        {
            "company_id": ["msft", "crm", "priv"],
            "primary_layer": ["cloud", "apps", "apps"],
            "market_cap_usd": [100.0, 50.0, 10.0],
            "prev_market_cap_usd": [90.0, 50.0, None],
        }
    )
    split = SegmentSplit(
        company_id="msft",
        fiscal_year="FY",
        source_url="https://e.com",
        notes="n",
        shares={"cloud": 0.4, "apps": 0.4, "other": 0.2},
    )
    shares = segment_shares(
        ["msft", "crm", "priv"], dict(zip(marks.company_id, marks.primary_layer, strict=True)), [split]
    )
    assert shares["crm"] == {"apps": 1.0}
    t = layer_totals(marks, LAYERS, shares)
    assert t.primary == {"cloud": 100.0, "apps": 60.0}
    assert t.segment == pytest.approx({"cloud": 40.0, "apps": 100.0})
    assert t.outside_stack == pytest.approx(20.0)
    # both modes reconcile to the company total
    assert sum(t.primary.values()) == pytest.approx(sum(t.segment.values()) + t.outside_stack)
    # day change only over companies with a previous mark (private excluded)
    assert t.day_change["cloud"] == pytest.approx(100 / 90 - 1)
    assert t.day_change["apps"] == pytest.approx(0.0)


def test_layer_without_prev_has_no_day_change() -> None:
    marks = pd.DataFrame({"company_id": ["p"], "primary_layer": ["apps"], "market_cap_usd": [5.0]})
    t = layer_totals(marks, LAYERS, {"p": {"apps": 1.0}})
    assert t.day_change == {"cloud": None, "apps": None}
