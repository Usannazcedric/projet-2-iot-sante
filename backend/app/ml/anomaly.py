from __future__ import annotations
import os
from typing import Any
import joblib
import numpy as np
from .bootstrap import FEATURES, model_path


_CACHE: dict[str, Any] = {}


def _load(resident_id: str, models_dir: str) -> Any | None:
    key = f"{models_dir}::{resident_id}"
    if key in _CACHE:
        return _CACHE[key]
    p = model_path(models_dir, resident_id)
    if not os.path.exists(p):
        return None
    model = joblib.load(p)
    _CACHE[key] = model
    return model


def reload(resident_id: str, models_dir: str) -> None:
    """Force next score() call to re-read the joblib (used after refit)."""
    _CACHE.pop(f"{models_dir}::{resident_id}", None)


def _to_matrix(window: list[dict[str, float]]) -> np.ndarray:
    rows = []
    for s in window:
        try:
            rows.append([float(s[f]) for f in FEATURES])
        except (KeyError, TypeError, ValueError):
            continue
    return np.array(rows, dtype=np.float32) if rows else np.empty((0, len(FEATURES)), dtype=np.float32)


def score(resident_id: str, window: list[dict[str, float]], models_dir: str) -> float:
    """Score a 0..1 anomaly value (higher = more anomalous) on the latest window."""
    if not window:
        return 0.0
    model = _load(resident_id, models_dir)
    if model is None:
        return 0.0
    X = _to_matrix(window)
    if X.size == 0:
        return 0.0
    decision = model.decision_function(X)  # higher = more normal
    mean_decision = float(np.mean(decision))
    # Map decision to 0..1 anomaly via sigmoid; normal IF decision is roughly in [-0.2, 0.2].
    anomaly = 1.0 / (1.0 + np.exp(8.0 * mean_decision))
    return float(np.clip(anomaly, 0.0, 1.0))
