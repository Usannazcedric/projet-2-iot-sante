from __future__ import annotations
import hashlib
import os
import numpy as np
import joblib
from sklearn.ensemble import IsolationForest


FEATURES = ("hr", "spo2", "sys", "dia", "temp")
SAMPLES_PER_DAY = 1440  # 1 sample/min


def _seed_for(resident_id: str) -> int:
    h = hashlib.sha256(resident_id.encode()).digest()
    return int.from_bytes(h[:4], "big")


def _baseline(resident_id: str) -> dict[str, float]:
    rng = np.random.default_rng(_seed_for(resident_id) ^ 0xA5A5)
    return {
        "hr": float(rng.uniform(65, 80)),
        "spo2": float(rng.uniform(96, 98)),
        "sys": float(rng.uniform(115, 135)),
        "dia": float(rng.uniform(70, 85)),
        "temp": float(rng.uniform(36.3, 36.9)),
    }


def synth_dataset(resident_id: str, days: int = 7) -> np.ndarray:
    """Generate synthetic 'normal' vitals for one resident.

    Circadian: hr/sys/dia rise during day, spo2/temp ~ stable. Noise per metric.
    """
    rng = np.random.default_rng(_seed_for(resident_id))
    base = _baseline(resident_id)
    n = days * SAMPLES_PER_DAY
    minutes = np.arange(n)
    hour_of_day = (minutes / 60.0) % 24.0
    circadian = np.sin((hour_of_day - 6) * np.pi / 12.0)  # peak around 18h, trough around 6h

    hr = base["hr"] + 6.0 * circadian + rng.normal(0, 2.5, n)
    spo2 = base["spo2"] + rng.normal(0, 0.6, n)
    sys = base["sys"] + 5.0 * circadian + rng.normal(0, 4.0, n)
    dia = base["dia"] + 3.0 * circadian + rng.normal(0, 3.0, n)
    temp = base["temp"] + 0.2 * circadian + rng.normal(0, 0.1, n)

    return np.column_stack([hr, spo2, sys, dia, temp]).astype(np.float32)


def model_path(models_dir: str, resident_id: str) -> str:
    return os.path.join(models_dir, f"{resident_id}.joblib")


def train_model(resident_id: str, models_dir: str, days: int = 7, force: bool = False) -> str:
    """Train (or reload) one IsolationForest per resident. Returns the joblib path."""
    os.makedirs(models_dir, exist_ok=True)
    path = model_path(models_dir, resident_id)
    if os.path.exists(path) and not force:
        return path
    data = synth_dataset(resident_id, days=days)
    model = IsolationForest(
        n_estimators=80,
        contamination=0.02,
        random_state=_seed_for(resident_id) & 0xFFFFFFFF,
    )
    model.fit(data)
    joblib.dump(model, path)
    return path
