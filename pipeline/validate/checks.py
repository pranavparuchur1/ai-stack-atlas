"""Data-quality checks. Any FAIL stops the run before anything is published.

Each check is a small pure function returning a CheckResult so it can be unit-tested
in isolation and rendered verbatim in the Pipeline Health view.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from datetime import date

import pandas as pd
import pandera.errors

from pipeline.config import CheckThresholds
from pipeline.frames import records
from pipeline.models import CheckResult, CheckStatus, Curated
from pipeline.transform.attribution import OUTSIDE, LayerTotals
from pipeline.validate.schemas import fx_schema, marks_schema, raw_prices_schema

PASS, WARN, FAIL = CheckStatus.pass_, CheckStatus.warn, CheckStatus.fail


def _result(name: str, bad: list[str], ok: str, msg: str, level: CheckStatus = FAIL) -> CheckResult:
    if not bad:
        return CheckResult(name=name, status=PASS, detail=ok)
    return CheckResult(name=name, status=level, detail=msg.format(n=len(bad)), failing=sorted(bad)[:50])


# ---------------------------------------------------------------- curated-only checks
def edges_reference_companies(cur: Curated) -> CheckResult:
    ids = {c.id for c in cur.companies}
    bad = [f"{e.source_id}->{e.target_id}" for e in cur.edges if e.source_id not in ids or e.target_id not in ids]
    return _result(
        "edges_reference_companies", bad, f"all {len(cur.edges)} edges resolve", "{n} edges reference unknown companies"
    )


def edges_have_evidence(cur: Curated) -> CheckResult:
    bad = [
        f"{e.source_id}->{e.target_id}"
        for e in cur.edges
        if not str(e.evidence_url).startswith(("http://", "https://"))
    ]
    return _result("edges_have_evidence", bad, "every edge has an http(s) evidence_url", "{n} edges lack evidence")


def edges_unique_and_not_self(cur: Curated) -> CheckResult:
    counts = Counter(e.key for e in cur.edges)
    bad = [f"duplicate {'/'.join(k)}" for k, n in counts.items() if n > 1]
    bad += [f"self-loop {e.source_id}" for e in cur.edges if e.source_id == e.target_id]
    return _result("edges_unique_and_not_self", bad, "no duplicate edges or self-loops", "{n} duplicate/self edges")


def evidence_not_in_future(cur: Curated, today: date) -> CheckResult:
    bad = [f"{e.source_id}->{e.target_id} {e.evidence_date}" for e in cur.edges if e.evidence_date > today]
    return _result("evidence_not_in_future", bad, "no evidence dated in the future", "{n} edges dated after today")


def undisclosed_magnitudes_explained(cur: Curated) -> CheckResult:
    """A null magnitude must come with a note saying why (spec: never invent a figure)."""
    bad = [f"{e.source_id}->{e.target_id}" for e in cur.edges if e.magnitude_usd is None and len(e.notes.strip()) < 20]
    n_null = sum(e.magnitude_usd is None for e in cur.edges)
    return _result(
        "undisclosed_magnitudes_explained",
        bad,
        f"{n_null} undisclosed magnitudes, all explained in notes",
        "{n} null magnitudes without an explanation",
    )


def layers_and_segments_valid(cur: Curated, tol: float = 1e-3) -> CheckResult:
    layer_ids = {l.id for l in cur.layers}
    ids = {c.id for c in cur.companies}
    bad = [
        f"{c.id}: unknown layer"
        for c in cur.companies
        if c.primary_layer not in layer_ids or any(s not in layer_ids for s in c.secondary_layers)
    ]
    for s in cur.segments:
        if s.company_id not in ids:
            bad.append(f"segments: unknown company {s.company_id}")
        if abs(sum(s.shares.values()) - 1) > tol:
            bad.append(f"{s.company_id}: segment shares sum to {sum(s.shares.values()):.4f}")
        bad += [f"{s.company_id}: unknown segment layer {k}" for k in s.shares if k not in layer_ids | {OUTSIDE}]
    return _result(
        "layers_and_segments_valid", bad, "layers resolve; segment shares sum to 1", "{n} layer/segment problems"
    )


def private_companies_have_valuation(cur: Curated) -> CheckResult:
    have = {v.company_id for v in cur.private_valuations}
    bad = [c.id for c in cur.companies if not c.is_public and c.id not in have]
    return _result(
        "private_companies_have_valuation",
        bad,
        "every private company has a valuation",
        "{n} private companies lack a valuation",
    )


def private_valuations_fresh(cur: Curated, today: date, max_age_days: int) -> CheckResult:
    public = {c.id for c in cur.companies if c.is_public}
    bad = [
        f"{v.company_id} ({(today - v.as_of_date).days}d)"
        for v in cur.private_valuations
        if v.company_id not in public and (today - v.as_of_date).days > max_age_days
    ]
    return _result(
        "private_valuations_fresh",
        bad,
        f"all private valuations within {max_age_days} days",
        "{n} private valuations older than " + str(max_age_days) + " days",
        level=WARN,
    )


CURATED_CHECKS: list[Callable[[Curated], CheckResult]] = [
    edges_reference_companies,
    edges_have_evidence,
    edges_unique_and_not_self,
    undisclosed_magnitudes_explained,
    layers_and_segments_valid,
    private_companies_have_valuation,
]


def curated_checks(cur: Curated, today: date, th: CheckThresholds) -> list[CheckResult]:
    return [f(cur) for f in CURATED_CHECKS] + [
        evidence_not_in_future(cur, today),
        private_valuations_fresh(cur, today, th.private_valuation_max_age_days),
    ]


# ---------------------------------------------------------------- market-data checks
def frame_schemas(raw: pd.DataFrame, fx: pd.DataFrame, marks: pd.DataFrame) -> CheckResult:
    bad: list[str] = []
    for name, schema, df in (
        ("raw_prices", raw_prices_schema, raw),
        ("fx_rates", fx_schema, fx),
        ("marks", marks_schema, marks),
    ):
        try:
            schema.validate(df, lazy=True)
        except pandera.errors.SchemaErrors as exc:
            bad.append(f"{name}: {len(exc.failure_cases)} failure cases")
    return _result(
        "frame_schemas",
        bad,
        "raw_prices, fx_rates and marks match their schemas",
        "{n} frames failed schema validation",
    )


def no_negative_market_caps(marks: pd.DataFrame) -> CheckResult:
    bad = marks.loc[marks["market_cap_usd"] < 0, "company_id"].tolist()
    return _result("no_negative_market_caps", bad, "all market caps >= 0", "{n} negative market caps")


def every_company_marked(marks: pd.DataFrame, cur: Curated) -> CheckResult:
    have = set(marks.loc[marks["market_cap_usd"].notna() & (marks["market_cap_usd"] > 0), "company_id"])
    bad = [c.id for c in cur.companies if c.id not in have]
    return _result(
        "every_company_marked",
        bad,
        f"all {len(cur.companies)} companies have a market cap or valuation",
        "{n} companies have no mark",
    )


def fx_present(prices_fx: pd.DataFrame, required: set[str], fx: pd.DataFrame) -> CheckResult:
    have = set(fx["currency"].unique()) | {"USD"}
    bad = [f"missing series {c}" for c in sorted(required - have)]
    gaps = prices_fx[prices_fx["fx_rate"].isna()]
    bad += [f"{r['company_id']} {r['date']}" for r in records(gaps.head(20))]
    return _result(
        "fx_present",
        bad,
        f"FX available for {sorted(required - {'USD'})} on every priced date",
        "{n} missing FX series or dates",
    )


def prices_fresh(marks: pd.DataFrame, today: date, max_days: int) -> CheckResult:
    pub = marks[marks["is_public"]]
    bad = [f"{r['company_id']} ({r['price_date']})" for r in records(pub) if (today - r["price_date"]).days > max_days]
    return _result("prices_fresh", bad, f"all latest prices within {max_days} days", "{n} stale prices", level=WARN)


def no_implausible_jumps(marks: pd.DataFrame, max_jump: float) -> CheckResult:
    pub = marks[marks["is_public"] & marks["day_change_pct"].notna()]
    bad = [
        f"{r['company_id']} {float(r['day_change_pct']):+.0%}"
        for r in records(pub)
        if abs(float(r["day_change_pct"])) > max_jump
    ]
    return _result(
        "no_implausible_jumps", bad, f"no 1-day move above {max_jump:.0%}", "{n} suspicious 1-day moves", level=WARN
    )


def layer_totals_reconcile(marks: pd.DataFrame, totals: LayerTotals, tol: float) -> CheckResult:
    grand = float(marks["market_cap_usd"].sum())
    prim = sum(totals.primary.values())
    seg = sum(totals.segment.values()) + totals.outside_stack
    bad = []
    for label, val in (("primary", prim), ("segment", seg)):
        if grand > 0 and abs(val - grand) / grand > tol:
            bad.append(f"{label}: {val:,.0f} vs companies {grand:,.0f}")
    return _result(
        "layer_totals_reconcile",
        bad,
        f"both attribution modes reconcile to ${grand / 1e12:,.2f}T",
        "{n} attribution modes do not reconcile",
    )


def summarize(results: list[CheckResult]) -> str:
    if any(r.status is FAIL for r in results):
        return "failed"
    return "passed_with_warnings" if any(r.status is WARN for r in results) else "passed"
