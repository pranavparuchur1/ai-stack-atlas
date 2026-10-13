"""pandera schemas for the frames that flow between stages."""

from __future__ import annotations

import pandera.pandas as pa

raw_prices_schema = pa.DataFrameSchema(
    {
        "ticker": pa.Column(str, nullable=False),
        "date": pa.Column(object, nullable=False),
        "close": pa.Column(float, pa.Check.gt(0), nullable=False),
    },
    unique=["ticker", "date"],
    strict=False,
    coerce=True,
)

fx_schema = pa.DataFrameSchema(
    {
        "currency": pa.Column(str, pa.Check.str_matches(r"^[A-Z]{3}$")),
        "date": pa.Column(object),
        "usd_per_unit": pa.Column(float, pa.Check.gt(0)),
    },
    unique=["currency", "date"],
    strict=False,
    coerce=True,
)

marks_schema = pa.DataFrameSchema(
    {
        "company_id": pa.Column(str, unique=True),
        "primary_layer": pa.Column(str),
        "market_cap_usd": pa.Column(float, nullable=True),
    },
    strict=False,
    coerce=True,
)
