"""DuckDB warehouse: DDL plus idempotent loads.

Curated tables are fully replaced each run (they are small and hand-maintained).
Market data is upserted on its natural key, so re-running a day is a no-op and
incremental runs only add or revise rows.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd

from pipeline.models import Curated

DDL = """
create table if not exists layers (
    id varchar primary key, name varchar, short varchar, ord integer, grp varchar, accent varchar);
create table if not exists companies (
    id varchar primary key, name varchar, ticker varchar, live_symbol varchar, exchange varchar,
    currency varchar, is_public boolean, primary_layer varchar, secondary_layers varchar[],
    hq_country varchar, logo_url varchar, listing_note varchar);
create table if not exists edges (
    source_id varchar, target_id varchar, relation_type varchar, direction varchar,
    magnitude_usd double, magnitude_basis varchar, stake_pct double, supplier_revenue_share double,
    confidence varchar, evidence_url varchar, evidence_date date, notes varchar,
    primary key (source_id, target_id, relation_type));
create table if not exists private_valuations (
    company_id varchar primary key, valuation double, currency varchar, basis varchar,
    as_of_date date, round varchar, source_url varchar, confidence varchar, notes varchar);
create table if not exists segments (
    company_id varchar, layer_id varchar, share double, fiscal_year varchar, source_url varchar,
    primary key (company_id, layer_id));
create table if not exists raw_prices (
    ticker varchar, date date, close double, source varchar, loaded_at timestamp,
    primary key (ticker, date));
create table if not exists fx_rates (
    currency varchar, date date, usd_per_unit double, source varchar,
    primary key (currency, date));
create table if not exists fundamentals (
    company_id varchar, as_of date, shares double, revenue_ttm double, revenue_currency varchar,
    revenue_ttm_usd double, source varchar,
    primary key (company_id, as_of));
create table if not exists prices (
    company_id varchar, ts date, price double, price_ccy varchar, fx_rate double,
    market_cap_usd double, source varchar, granularity varchar,
    primary key (company_id, ts, granularity));
create table if not exists events (
    id varchar primary key, name varchar, type varchar, params json, created_at timestamp);
create table if not exists pipeline_runs (
    run_id varchar primary key, started_at timestamp, finished_at timestamp, status varchar,
    as_of date, row_counts json, check_results json);
"""


def _as_dates(df: pd.DataFrame, col: str) -> pd.DataFrame:
    """DuckDB returns DATE as datetime64; the transforms work in python `date`s."""
    df[col] = pd.to_datetime(df[col]).dt.date
    return df


class Warehouse:
    def __init__(self, path: Path | str) -> None:
        if isinstance(path, Path):
            path.parent.mkdir(parents=True, exist_ok=True)
        self.con = duckdb.connect(str(path))
        self.con.execute(DDL)

    def close(self) -> None:
        self.con.close()

    # ------------------------------------------------------------------ generic
    def upsert(self, table: str, df: pd.DataFrame) -> int:
        """INSERT OR REPLACE rows on the table's primary key. Returns rows written."""
        if df.empty:
            return 0
        self.con.register("_incoming", df)
        cols = ", ".join(df.columns)
        self.con.execute(f"insert or replace into {table} ({cols}) select {cols} from _incoming")
        self.con.unregister("_incoming")
        return len(df)

    def replace_all(self, table: str, df: pd.DataFrame) -> int:
        self.con.execute("begin")
        try:
            self.con.execute(f"delete from {table}")
            n = self.upsert(table, df)
            self.con.execute("commit")
        except Exception:
            self.con.execute("rollback")
            raise
        return n

    def query(self, sql: str, params: list[Any] | None = None) -> pd.DataFrame:
        return self.con.execute(sql, params or []).df()

    def count(self, table: str) -> int:
        row = self.con.execute(f"select count(*) from {table}").fetchone()
        return int(row[0]) if row else 0

    # ------------------------------------------------------------------ curated
    def load_curated(self, cur: Curated) -> dict[str, int]:
        layers = pd.DataFrame(
            [
                {"id": l.id, "name": l.name, "short": l.short, "ord": l.order, "grp": l.group, "accent": l.accent}
                for l in cur.layers
            ]
        )
        companies = pd.DataFrame([c.model_dump() for c in cur.companies])
        edges = pd.DataFrame([e.model_dump(mode="json") for e in cur.edges])
        vals = pd.DataFrame([v.model_dump(mode="json") for v in cur.private_valuations])
        segs = pd.DataFrame(
            [
                {
                    "company_id": s.company_id,
                    "layer_id": layer,
                    "share": share,
                    "fiscal_year": s.fiscal_year,
                    "source_url": str(s.source_url),
                }
                for s in cur.segments
                for layer, share in s.shares.items()
            ]
        )
        return {
            "layers": self.replace_all("layers", layers),
            "companies": self.replace_all("companies", companies),
            "edges": self.replace_all("edges", edges),
            "private_valuations": self.replace_all("private_valuations", vals),
            "segments": self.replace_all("segments", segs),
        }

    # ------------------------------------------------------------------ market data
    def max_dates(self) -> dict[str, date]:
        df = self.query("select ticker, max(date) as d from raw_prices group by ticker")
        return {str(t): pd.Timestamp(d).date() for t, d in zip(df["ticker"], df["d"], strict=True)}

    def raw_prices_since(self, start: date) -> pd.DataFrame:
        df = self.query("select ticker, date, close, source from raw_prices where date >= ? order by date", [start])
        return _as_dates(df, "date")

    def fx_since(self, start: date) -> pd.DataFrame:
        df = self.query("select currency, date, usd_per_unit from fx_rates where date >= ? order by date", [start])
        return _as_dates(df, "date")

    def latest_fundamentals(self) -> pd.DataFrame:
        return self.query(
            """select * from fundamentals
               qualify row_number() over (partition by company_id order by as_of desc) = 1"""
        )

    def has_fundamentals_for(self, day: date) -> bool:
        row = self.con.execute("select count(*) from fundamentals where as_of = ?", [day]).fetchone()
        return bool(row and row[0])

    # ------------------------------------------------------------------ runs
    def record_run(self, run: dict[str, Any]) -> None:
        df = pd.DataFrame(
            [{**run, "row_counts": json.dumps(run["row_counts"]), "check_results": json.dumps(run["check_results"])}]
        )
        self.upsert("pipeline_runs", df)

    def recent_runs(self, limit: int = 30) -> pd.DataFrame:
        return self.query(
            "select run_id, started_at, finished_at, status, as_of from pipeline_runs order by started_at desc limit ?",
            [limit],
        )
