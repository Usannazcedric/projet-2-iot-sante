from __future__ import annotations
import numpy as np


MIN_SAMPLES = 10


def _slope(values: list[float]) -> float:
    arr = np.array(values, dtype=np.float32)
    n = len(arr)
    if n < 2:
        return 0.0
    # Newest-first → reverse to oldest-first for slope.
    arr = arr[::-1]
    x = np.arange(n, dtype=np.float32)
    x_mean = x.mean()
    y_mean = arr.mean()
    denom = float(np.sum((x - x_mean) ** 2))
    if denom == 0.0:
        return 0.0
    return float(np.sum((x - x_mean) * (arr - y_mean)) / denom)


def _norm(v: float, scale: float) -> float:
    return float(np.clip(abs(v) / scale, 0.0, 1.0))


def score(window: list[dict[str, float]]) -> float:
    """Trend score 0..1: rising HR, falling SpO2, deviating temp."""
    if len(window) < MIN_SAMPLES:
        return 0.0
    hr = [s.get("hr") for s in window if isinstance(s.get("hr"), (int, float))]
    spo2 = [s.get("spo2") for s in window if isinstance(s.get("spo2"), (int, float))]
    temp = [s.get("temp") for s in window if isinstance(s.get("temp"), (int, float))]

    if not hr or not spo2 or not temp:
        return 0.0

    hr_slope = _slope(hr)        # bpm per sample; alarming if positive (rising) ~ 0.5+
    spo2_slope = _slope(spo2)    # alarming if negative (falling)
    temp_slope = _slope(temp)    # alarming either direction

    hr_score = _norm(max(0.0, hr_slope), 0.5)
    spo2_score = _norm(max(0.0, -spo2_slope), 0.1)
    temp_score = _norm(temp_slope, 0.05)

    # Any single saturated axis is clinically significant; use max so one critical sign dominates.
    combined = max(hr_score, spo2_score, temp_score)
    return float(np.clip(combined, 0.0, 1.0))
