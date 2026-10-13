"""End-to-end runs against the offline FakeProvider."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pipeline import cli
from pipeline.config import Settings
from pipeline.extract.providers.base import Quote
from pipeline.run import failed, run_pipeline
from tests.conftest import TODAY, FakeProvider


def _read(settings: Settings, name: str) -> dict:  # type: ignore[type-arg]
    return json.loads((settings.out_dir / name).read_text(encoding="utf-8"))


def test_full_run_publishes_consistent_outputs(settings: Settings, fake_provider: FakeProvider) -> None:
    report = run_pipeline(settings, fake_provider, today=TODAY)
    assert report.ok, failed(report.checks)
    assert report.status == "passed_with_warnings"  # stale private valuations warn by design
    assert set(report.outputs) == {
        "snapshot_latest.json",
        f"history/{TODAY}.json",
        "analytics.json",
        "prices_1y.json",
        "model.json",
    }

    snap = _read(settings, "snapshot_latest.json")
    total = sum(c["market_cap_usd"] for c in snap["companies"])
    assert total == pytest.approx(snap["total_market_cap_usd"])
    assert sum(l["total_primary_usd"] for l in snap["layers"]) == pytest.approx(total)
    assert sum(l["total_segment_usd"] for l in snap["layers"]) + snap["outside_stack_segment_usd"] == pytest.approx(
        total
    )
    anthropic = next(c for c in snap["companies"] if c["id"] == "anthropic")
    assert anthropic["market_cap_usd"] == 965e9 and anthropic["valuation"]["round"].startswith("Series H")
    assert all(e["evidence_url"].startswith("http") for e in snap["edges"])

    an = _read(settings, "analytics.json")
    n = len(an["company_ids"])
    assert len(an["correlation"]) == n and all(len(r) == n for r in an["correlation"])
    assert set(an["layer_index"]["levels"]) == {"power", "infra", "semicap", "chips", "cloud", "models", "apps"}

    lin = _read(settings, "lineage.json")
    assert lin["status"] == "passed_with_warnings" and lin["row_counts"]["edges"] == len(snap["edges"])
    assert {n["kind"] for n in lin["nodes"]} == {"source", "transform", "check", "output"}


def test_rerun_is_idempotent_and_incremental(settings: Settings) -> None:
    p = FakeProvider()
    first = run_pipeline(settings, p, today=TODAY)
    second = run_pipeline(settings, p, today=TODAY)
    assert first.row_counts == second.row_counts
    cold_start, warm_start = p.history_calls[0][0], p.history_calls[1][0]
    assert cold_start == TODAY - timedelta(days=settings.history_days)
    assert warm_start == TODAY - timedelta(days=settings.refetch_overlap_days)

    third = run_pipeline(settings, p, today=TODAY + timedelta(days=1))  # next day adds one session per ticker
    assert third.row_counts["raw_prices"] > first.row_counts["raw_prices"]


def test_failed_check_blocks_publication(settings: Settings, fake_provider: FakeProvider) -> None:
    edges = settings.data_dir / "edges.yaml"
    edges.write_text(
        edges.read_text(encoding="utf-8").replace("target_id: meta", "target_id: ghost", 1), encoding="utf-8"
    )
    report = run_pipeline(settings, fake_provider, today=TODAY)
    assert report.status == "failed"
    assert [r.name for r in failed(report.checks)] == ["edges_reference_companies"]
    assert not (settings.out_dir / "snapshot_latest.json").exists()
    assert _read(settings, "lineage.json")["status"] == "failed"  # health view still sees the failure


def test_missing_fx_fails(settings: Settings) -> None:
    report = run_pipeline(settings, FakeProvider(missing_fx=["KRW"]), today=TODAY)
    assert "fx_present" in [r.name for r in failed(report.checks)]


def test_quotes_override_latest(settings: Settings, fake_provider: FakeProvider) -> None:
    class Q:
        name = "stub"

        def quotes(self, tickers):  # type: ignore[no-untyped-def]
            return [Quote("NVDA", 999.0, datetime(2026, 10, 13, 15, tzinfo=UTC))]

    run_pipeline(settings, fake_provider, [Q()], today=TODAY)
    nvda = next(c for c in _read(settings, "snapshot_latest.json")["companies"] if c["id"] == "nvda")
    assert nvda["price"] == 999.0 and nvda["source"] == "stub"


def test_cli_check_and_schema(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["check"]) == 0
    assert "companies" in capsys.readouterr().out
    assert cli.main(["export-schema", "--out", str(tmp_path)]) == 0
    schema = json.loads((tmp_path / "Snapshot.schema.json").read_text(encoding="utf-8"))
    assert "companies" in schema["properties"]


def test_cli_run_uses_provider(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    from pipeline.extract.providers import yfinance as yfp

    monkeypatch.setattr(yfp, "YFinanceProvider", FakeProvider)
    monkeypatch.setattr(cli.Settings, "load", classmethod(lambda cls, *a, **k: settings))
    monkeypatch.setattr("pipeline.run.datetime", _FrozenDatetime)
    assert cli.main(["run"]) == 0
    assert (settings.out_dir / "snapshot_latest.json").exists()


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):  # type: ignore[no-untyped-def]
        return datetime(2026, 10, 13, 20, 0, tzinfo=UTC)
