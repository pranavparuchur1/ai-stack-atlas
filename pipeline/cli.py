"""`uv run pipeline [run|check|export-schema]`."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

from pipeline.config import ROOT, Settings
from pipeline.extract.curated import load_curated
from pipeline.extract.providers import quote_providers
from pipeline.models import Analytics, Backtests, CheckStatus, Lineage, ModelParams, PriceSeries, Snapshot
from pipeline.validate.checks import curated_checks

ICON = {CheckStatus.pass_: "PASS", CheckStatus.warn: "WARN", CheckStatus.fail: "FAIL"}


def _print_checks(results: list) -> None:  # type: ignore[type-arg]
    for r in results:
        print(f"  [{ICON[r.status]}] {r.name}: {r.detail}")
        for f in r.failing[:10]:
            print(f"         - {f}")


def cmd_run(args: argparse.Namespace) -> int:
    from pipeline.extract.providers.yfinance import YFinanceProvider
    from pipeline.run import run_pipeline

    st = Settings.load()
    if args.warehouse:
        st = Settings.load(warehouse=Path(args.warehouse))
    report = run_pipeline(st, YFinanceProvider(), quote_providers(st.providers))
    print(f"run {report.run_id}: {report.status}")
    _print_checks(report.checks)
    print("rows:", json.dumps(report.row_counts))
    if report.outputs:
        print("wrote:", ", ".join(report.outputs), "->", st.out_dir)
    return 0 if report.ok else 1


def cmd_check(_: argparse.Namespace) -> int:
    """Validate curated YAML only (no network) - fast gate for PRs that add companies/edges."""
    st = Settings.load()
    cur = load_curated(st.data_dir)
    results = curated_checks(cur, datetime.now(UTC).date(), st.checks)
    print(f"{len(cur.companies)} companies, {len(cur.edges)} edges, {len(cur.private_valuations)} private valuations")
    _print_checks(results)
    return 1 if any(r.status is CheckStatus.fail for r in results) else 0


def cmd_export_schema(args: argparse.Namespace) -> int:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for model in (Snapshot, Analytics, PriceSeries, Lineage, ModelParams, Backtests):
        (out / f"{model.__name__}.schema.json").write_text(
            json.dumps(model.model_json_schema(mode="serialization"), indent=2) + "\n", encoding="utf-8"
        )
        print("wrote", out / f"{model.__name__}.schema.json")
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
    p = argparse.ArgumentParser(prog="pipeline", description="AI Stack Atlas data pipeline")
    sub = p.add_subparsers(dest="cmd")
    r = sub.add_parser("run", help="extract, transform, validate and publish snapshots (default)")
    r.add_argument("--warehouse", help="DuckDB path (default data/warehouse/atlas.duckdb)")
    r.set_defaults(func=cmd_run)
    sub.add_parser("check", help="validate curated YAML only").set_defaults(func=cmd_check)
    e = sub.add_parser("export-schema", help="write JSON Schema for the published files")
    e.add_argument("--out", default=str(ROOT / "schema"))
    e.set_defaults(func=cmd_export_schema)
    args = p.parse_args(argv)
    if not getattr(args, "func", None):
        args = p.parse_args(["run", *(argv or [])])
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
