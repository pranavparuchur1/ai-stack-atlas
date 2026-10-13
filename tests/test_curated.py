from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from pipeline.config import ROOT
from pipeline.extract.curated import load_curated
from pipeline.models import Company, Edge

EDGE = {
    "source_id": "a",
    "target_id": "b",
    "relation_type": "compute_contract",
    "direction": "supplies_to",
    "confidence": "reported",
    "evidence_url": "https://example.com/x",
    "evidence_date": "2026-01-01",
    "notes": "a sufficiently long note",
}


def test_real_curated_data_loads() -> None:
    cur = load_curated(ROOT / "data")
    assert len(cur.companies) >= 60
    assert len(cur.edges) >= 100
    assert {l.id for l in cur.layers} == {"power", "infra", "semicap", "chips", "cloud", "models", "apps"}


def test_magnitude_requires_basis() -> None:
    with pytest.raises(ValidationError, match="go together"):
        Edge(**{**EDGE, "magnitude_usd": 1e9})


def test_stake_pct_only_on_equity() -> None:
    with pytest.raises(ValidationError, match="stake_pct"):
        Edge(**{**EDGE, "stake_pct": 0.1})


def test_equity_stake_must_invest() -> None:
    with pytest.raises(ValidationError, match="invests_in"):
        Edge(**{**EDGE, "relation_type": "equity_stake"})


def test_unknown_relation_rejected() -> None:
    with pytest.raises(ValidationError):
        Edge(**{**EDGE, "relation_type": "vibes"})


def test_evidence_must_be_url() -> None:
    with pytest.raises(ValidationError):
        Edge(**{**EDGE, "evidence_url": "not a url"})


def test_public_company_needs_ticker() -> None:
    with pytest.raises(ValidationError, match="ticker"):
        Company(id="x", name="X", currency="USD", is_public=True, primary_layer="apps", hq_country="US")


def test_primary_not_in_secondary() -> None:
    with pytest.raises(ValidationError, match="secondary"):
        Company(
            id="x",
            name="X",
            ticker="X",
            currency="USD",
            is_public=True,
            primary_layer="apps",
            secondary_layers=["apps"],
            hq_country="US",
        )


def test_missing_top_level_key(project: Path) -> None:
    (project / "data" / "edges.yaml").write_text("not_edges: []\n", encoding="utf-8")
    with pytest.raises(ValueError, match="'edges'"):
        load_curated(project / "data")
