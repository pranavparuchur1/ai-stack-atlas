"""Load the hand-curated YAML under data/ into validated Pydantic models."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from pipeline.models import Company, Curated, Edge, Layer, ModelParams, PrivateValuation, SegmentSplit


def _read(path: Path, key: str) -> list[dict[str, Any]]:
    doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    rows = doc.get(key)
    if not isinstance(rows, list):
        raise ValueError(f"{path.name}: expected a top-level '{key}' list")
    return rows


def load_curated(data_dir: Path) -> Curated:
    """Parse and validate every curated file. Raises pydantic.ValidationError on bad rows."""
    return Curated(
        layers=[Layer(**r) for r in _read(data_dir / "layers.yaml", "layers")],
        companies=[Company(**r) for r in _read(data_dir / "companies.yaml", "companies")],
        private_valuations=[
            PrivateValuation(**r) for r in _read(data_dir / "private_valuations.yaml", "private_valuations")
        ],
        edges=[Edge(**r) for r in _read(data_dir / "edges.yaml", "edges")],
        segments=[SegmentSplit(**r) for r in _read(data_dir / "segments.yaml", "segments")],
    )


def load_model_params(path: Path) -> ModelParams:
    """Validate config/model.yaml (propagation-model assumptions published as model.json)."""
    return ModelParams(**(yaml.safe_load(path.read_text(encoding="utf-8")) or {}))
