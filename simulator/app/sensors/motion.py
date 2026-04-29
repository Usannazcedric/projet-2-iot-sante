from __future__ import annotations
from typing import TypedDict
import numpy as np


class Accel(TypedDict):
    ax: float
    ay: float
    az: float
    activity: str


def generate(activity: str, rng: np.random.Generator) -> Accel:
    if activity == "walking":
        ax = float(rng.normal(0.0, 0.4))
        ay = float(rng.normal(0.0, 0.4))
        az = float(rng.normal(9.81, 0.6))
    elif activity == "sitting":
        ax = float(rng.normal(0.0, 0.05))
        ay = float(rng.normal(0.0, 0.05))
        az = float(rng.normal(9.81, 0.05))
    elif activity == "lying":
        ax = float(rng.normal(0.0, 0.05))
        ay = float(rng.normal(9.81, 0.1))
        az = float(rng.normal(0.0, 0.05))
    else:
        ax = float(rng.normal(0.0, 0.02))
        ay = float(rng.normal(0.0, 0.02))
        az = float(rng.normal(9.81, 0.02))
    return Accel(ax=round(ax, 3), ay=round(ay, 3), az=round(az, 3), activity=activity)


def fall_pattern(rng: np.random.Generator) -> Accel:
    spike = float(rng.uniform(20.0, 35.0))
    ax = float(rng.normal(0.0, 1.5))
    return Accel(ax=round(ax, 3), ay=round(spike, 3), az=round(0.0, 3), activity="falling")
