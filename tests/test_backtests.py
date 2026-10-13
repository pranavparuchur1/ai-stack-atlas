from __future__ import annotations

import json
from datetime import date

import pandas as pd
import pytest
from pydantic import ValidationError

from pipeline.config import ROOT, Settings
from pipeline.models import BacktestEventSpec
from pipeline.run import run_pipeline
from pipeline.transform.backtest_inputs import load_events, window_returns
from tests.conftest import TODAY, FakeProvider


def test_window_returns_from_prior_close() -> None:
    s = pd.Series(
        [100.0, 110.0, 121.0, 99.0, 120.0, 130.0, 140.0],
        index=[date(2026, 5, d) for d in (26, 27, 28, 29, 30, 31)] + [date(2026, 6, 1)],
    )
    base, r = window_returns(s, date(2026, 5, 28))
    assert base == 110.0
    assert r["1"] == pytest.approx(121 / 110 - 1)
    assert r["3"] == pytest.approx(120 / 110 - 1)
    assert r["5"] == pytest.approx(140 / 110 - 1)
    assert window_returns(s, date(2026, 5, 1))[0] is None  # no close before the event
    short = window_returns(s, date(2026, 6, 1))[1]
    assert short["1"] is not None and short["3"] is None


def test_real_event_specs_load() -> None:
    specs, h = load_events(ROOT / "data" / "backtest_events.yaml")
    assert {s.id for s in specs} == {"anthropic_series_h", "openai_feb_2026_round", "alphabet_capex_q2_2026"}
    assert len(h) == 16


def test_effective_date_cannot_precede_date() -> None:
    with pytest.raises(ValidationError, match="effective_date"):
        BacktestEventSpec(
            id="x",
            name="x",
            date=date(2026, 1, 2),
            effective_date=date(2026, 1, 1),
            description="d",
            source_url="https://e.com",
            scenario={"company_id": "nvda", "type": "demand_shock", "pct": 0.1},
        )


def test_backtests_published_without_lookahead_and_cached(settings: Settings) -> None:
    p = FakeProvider()
    run_pipeline(settings, p, today=TODAY)
    bt = json.loads((settings.out_dir / "backtests.json").read_text(encoding="utf-8"))
    assert bt["benchmark"] == "SPY" and bt["windows"] == [1, 3, 5]
    edges = json.loads((settings.out_dir / "snapshot_latest.json").read_text(encoding="utf-8"))["edges"]
    dates = {e["id"]: e["evidence_date"] for e in edges}
    for ev in bt["events"]:
        assert all(dates[i] <= ev["date"] for i in ev["edge_ids"])  # no look-ahead
        ids = {c["id"] for c in ev["companies"]}
        assert ev["scenario"]["company_id"] in ids
        nvda = next(c for c in ev["companies"] if c["id"] == "nvda")
        assert nvda["cap_before"] > 0 and set(nvda["actual"]) == {"1", "3", "5"}
    anthropic = next(e for e in bt["events"] if e["id"] == "anthropic_series_h")
    assert next(c for c in anthropic["companies"] if c["id"] == "anthropic")["cap_before"] == 380e9
    calls = len(p.history_calls)
    run_pipeline(settings, p, today=TODAY)  # unchanged spec -> not rebuilt
    assert len(p.history_calls) == calls + 1  # only the incremental price fetch


def test_events_table_seeded(settings: Settings) -> None:
    from pipeline.load.warehouse import Warehouse

    run_pipeline(settings, FakeProvider(), today=TODAY)
    wh = Warehouse(settings.warehouse)
    ev = wh.query("select id, type, params from events order by id")
    wh.close()
    assert ev["id"].tolist() == ["alphabet_capex_q2_2026", "anthropic_series_h", "openai_feb_2026_round"]
    assert json.loads(ev.loc[0, "params"])["pct"] == pytest.approx(0.0811)
