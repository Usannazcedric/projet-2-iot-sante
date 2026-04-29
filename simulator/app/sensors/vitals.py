from __future__ import annotations
from typing import TypedDict
import numpy as np
from ..profiles import Profile


class Vitals(TypedDict):
    hr: int
    spo2: int
    sys: int
    dia: int
    temp: float


def generate(
    profile: Profile,
    activity: str,
    rng: np.random.Generator,
    *,
    scenario: str = "normal",
    severity: float = 0.0,
) -> Vitals:
    b = profile.baseline
    activity_hr_offset = {"idle": 0, "sitting": 0, "walking": 8, "lying": -3}.get(activity, 0)
    hr_drift = 0.0
    spo2_drift = 0.0
    if scenario == "cardiac":
        hr_drift = 60.0 * severity
        spo2_drift = -8.0 * severity
    elif scenario == "degradation":
        hr_drift = 12.0 * severity
        spo2_drift = -5.0 * severity
    hr = int(b.hr + activity_hr_offset + hr_drift + rng.normal(0, 1.5))
    spo2 = int(np.clip(b.spo2 + spo2_drift + rng.normal(0, 0.4), 70, 100))
    sys = int(b.sys + rng.normal(0, 4))
    dia = int(b.dia + rng.normal(0, 3))
    if dia > sys - 20:
        dia = sys - 20
    temp = float(round(b.temp + rng.normal(0, 0.1), 2))
    return Vitals(hr=hr, spo2=spo2, sys=sys, dia=dia, temp=temp)
