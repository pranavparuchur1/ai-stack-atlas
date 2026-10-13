"""Typed row access for DataFrames (pandas-stubs types itertuples() fields as unions)."""

from __future__ import annotations

from typing import Any

import pandas as pd


def records(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Rows as plain dicts - explicit `Any` values the caller converts with float()/str()."""
    return [{str(k): v for k, v in row.items()} for row in df.to_dict("records")]
