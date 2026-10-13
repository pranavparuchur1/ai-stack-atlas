from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

from pipeline.config import ROOT, CheckThresholds
from pipeline.extract.curated import load_curated
from pipeline.models import CheckStatus, Edge
from pipeline.transform.attribution import LayerTotals
from pipeline.validate import checks as ck

CUR = load_curated(ROOT / "data")
TODAY = date(2026, 10, 13)
P, W, F = CheckStatus.pass_, CheckStatus.warn, CheckStatus.fail


def _with_edges(*extra: Edge):  # type: ignore[no-untyped-def]
    return CUR.model_copy(update={"edges": CUR.edges + list(extra)})


def _edge(**kw: object) -> Edge:
    base = {
        "source_id": "nvda",
        "target_id": "msft",
        "relation_type": "chip_supply",
        "direction": "supplies_to",
        "confidence": "reported",
        "evidence_url": "https://e.com/x",
        "evidence_date": "2026-01-01",
        "notes": "a sufficiently long explanation",
    }
    return Edge(**{**base, **kw})


def test_curated_checks_pass_on_real_data() -> None:
    results = ck.curated_checks(CUR, TODAY, CheckThresholds())
    assert all(r.status is not F for r in results), [r for r in results if r.status is F]


def test_unknown_company_fails() -> None:
    r = ck.edges_reference_companies(_with_edges(_edge(target_id="ghost")))
    assert r.status is F and "nvda->ghost" in r.failing


def test_duplicate_and_self_loop_fail() -> None:
    dup = CUR.edges[0]
    r = ck.edges_unique_and_not_self(_with_edges(dup, _edge(source_id="msft", target_id="msft")))
    assert r.status is F
    assert any(f.startswith("duplicate") for f in r.failing)
    assert "self-loop msft" in r.failing


def test_future_evidence_fails() -> None:
    r = ck.evidence_not_in_future(_with_edges(_edge(evidence_date=str(TODAY + timedelta(days=1)))), TODAY)
    assert r.status is F


def test_short_note_on_null_magnitude_fails() -> None:
    e = _edge().model_copy(update={"notes": "tbd"})
    assert ck.undisclosed_magnitudes_explained(_with_edges(e)).status is F


def test_segments_must_sum_to_one() -> None:
    seg = CUR.segments[0].model_copy(update={"shares": {"cloud": 0.5, "apps": 0.3}})
    bad = CUR.model_copy(update={"segments": [seg]})
    r = ck.layers_and_segments_valid(bad)
    assert r.status is F and "sum to" in r.failing[0]


def test_private_without_valuation_fails() -> None:
    bad = CUR.model_copy(update={"private_valuations": CUR.private_valuations[1:]})
    assert ck.private_companies_have_valuation(bad).status is F


def test_stale_private_valuation_warns() -> None:
    r = ck.private_valuations_fresh(CUR, TODAY, max_age_days=365)
    assert r.status is W and any(f.startswith("ssi") for f in r.failing)
    assert ck.private_valuations_fresh(CUR, TODAY, max_age_days=10_000).status is P


def _marks(**cols: list[object]) -> pd.DataFrame:
    base: dict[str, list[object]] = {
        "company_id": ["a", "b"],
        "primary_layer": ["apps", "apps"],
        "is_public": [True, True],
        "market_cap_usd": [10.0, 20.0],
        "day_change_pct": [0.01, -0.02],
        "price_date": [TODAY, TODAY],
    }
    return pd.DataFrame({**base, **cols})


def test_negative_cap_fails() -> None:
    assert ck.no_negative_market_caps(_marks(market_cap_usd=[-1.0, 2.0])).status is F
    assert ck.no_negative_market_caps(_marks()).status is P


def test_every_company_marked() -> None:
    r = ck.every_company_marked(_marks(), CUR)
    assert r.status is F and len(r.failing) == min(50, len(CUR.companies))


def test_fx_present() -> None:
    fx = pd.DataFrame({"currency": ["KRW"], "date": [TODAY], "usd_per_unit": [0.0007]})
    ok = pd.DataFrame({"company_id": ["sk"], "date": [TODAY], "fx_rate": [0.0007]})
    assert ck.fx_present(ok, {"USD", "KRW"}, fx).status is P
    gap = ok.assign(fx_rate=[float("nan")])
    r = ck.fx_present(gap, {"USD", "KRW", "JPY"}, fx)
    assert r.status is F and "missing series JPY" in r.failing


def test_stale_price_and_jump_warn() -> None:
    m = _marks(price_date=[TODAY, TODAY - timedelta(days=9)], day_change_pct=[0.9, 0.0])
    assert ck.prices_fresh(m, TODAY, 4).status is W
    assert ck.no_implausible_jumps(m, 0.6).status is W


def test_reconcile() -> None:
    m = _marks()
    good = LayerTotals(primary={"apps": 30.0}, segment={"apps": 25.0}, outside_stack=5.0, day_change={})
    bad = LayerTotals(primary={"apps": 30.0}, segment={"apps": 20.0}, outside_stack=5.0, day_change={})
    assert ck.layer_totals_reconcile(m, good, 1e-6).status is P
    assert ck.layer_totals_reconcile(m, bad, 1e-6).status is F


def test_frame_schemas_detect_bad_close() -> None:
    raw = pd.DataFrame({"ticker": ["A"], "date": [TODAY], "close": [-1.0]})
    fx = pd.DataFrame({"currency": ["KRW"], "date": [TODAY], "usd_per_unit": [0.1]})
    r = ck.frame_schemas(raw, fx, _marks())
    assert r.status is F and r.failing[0].startswith("raw_prices")


def test_summarize() -> None:
    from pipeline.models import CheckResult

    mk = lambda s: CheckResult(name="x", status=s, detail="")  # noqa: E731
    assert ck.summarize([mk(P)]) == "passed"
    assert ck.summarize([mk(P), mk(W)]) == "passed_with_warnings"
    assert ck.summarize([mk(W), mk(F)]) == "failed"
