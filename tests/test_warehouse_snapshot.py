from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from pipeline.config import ROOT
from pipeline.extract.curated import load_curated
from pipeline.load.snapshot import sig, write_json
from pipeline.load.warehouse import Warehouse


def test_upsert_is_idempotent(tmp_path: Path) -> None:
    wh = Warehouse(tmp_path / "w.duckdb")
    df = pd.DataFrame(
        {
            "ticker": ["A", "A"],
            "date": [date(2026, 1, 1), date(2026, 1, 2)],
            "close": [1.0, 2.0],
            "source": ["t", "t"],
            "loaded_at": [pd.Timestamp("2026-01-02")] * 2,
        }
    )
    wh.upsert("raw_prices", df)
    wh.upsert("raw_prices", df)
    assert wh.count("raw_prices") == 2
    wh.upsert("raw_prices", df.iloc[[1]].assign(close=3.0))  # revision overwrites, does not append
    assert wh.count("raw_prices") == 2
    assert wh.raw_prices_since(date(2026, 1, 2))["close"].tolist() == [3.0]
    assert wh.max_dates() == {"A": date(2026, 1, 2)}
    assert wh.upsert("raw_prices", df.iloc[0:0]) == 0
    wh.close()


def test_load_curated_replaces(tmp_path: Path) -> None:
    wh = Warehouse(tmp_path / "w.duckdb")
    cur = load_curated(ROOT / "data")
    first = wh.load_curated(cur)
    second = wh.load_curated(cur)
    assert first == second
    assert wh.count("edges") == len(cur.edges)
    seg_rows = sum(len(s.shares) for s in cur.segments)
    assert wh.count("segments") == seg_rows
    wh.close()


def test_replace_all_rolls_back_on_error(tmp_path: Path) -> None:
    wh = Warehouse(tmp_path / "w.duckdb")
    wh.upsert("layers", pd.DataFrame([{"id": "a", "name": "A", "short": "A", "ord": 1, "grp": "1", "accent": "x"}]))
    with pytest.raises(Exception):
        wh.replace_all("layers", pd.DataFrame([{"id": "b", "nope": 1}]))
    assert wh.count("layers") == 1
    wh.close()


def test_record_run_roundtrip(tmp_path: Path) -> None:
    wh = Warehouse(tmp_path / "w.duckdb")
    wh.record_run(
        {
            "run_id": "r1",
            "started_at": pd.Timestamp("2026-01-01 10:00"),
            "finished_at": pd.Timestamp("2026-01-01 10:01"),
            "status": "passed",
            "as_of": date(2026, 1, 1),
            "row_counts": {"x": 1},
            "check_results": [],
        }
    )
    runs = wh.recent_runs()
    assert runs["run_id"].tolist() == ["r1"]
    wh.close()


@pytest.mark.parametrize(
    ("value", "digits", "expected"),
    [
        (123456789.0, 3, 123000000.0),
        (0.000123456, 2, 0.00012),
        (0.0, 4, 0.0),
        (None, 4, None),
        (float("nan"), 4, None),
        (float("inf"), 4, None),
        ("x", 4, None),
        (-9876.5, 2, -9900.0),
    ],
)
def test_sig(value: object, digits: int, expected: float | None) -> None:
    assert sig(value, digits) == expected


def test_write_json_atomic(tmp_path: Path) -> None:
    target = tmp_path / "sub" / "out.json"
    write_json(target, {"a": 1})
    assert json.loads(target.read_text()) == {"a": 1}
    assert not list(target.parent.glob("*.tmp"))
