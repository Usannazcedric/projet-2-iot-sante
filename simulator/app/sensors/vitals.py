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


def generate(profile: Profile, activity: str, rng: np.random.Generator) -> Vitals:
    b = profile.baseline
    activity_hr_offset = {"idle": 0, "sitting": 0, "walking": 8, "lying": -3}.get(activity, 0)
    hr = int(b.hr + activity_hr_offset + rng.normal(0, 3))
    spo2 = int(np.clip(b.spo2 + rng.normal(0, 1), 90, 100))
    sys = int(b.sys + rng.normal(0, 4))
    dia = int(b.dia + rng.normal(0, 3))
    if dia > sys - 20:
        dia = sys - 20
    temp = float(round(b.temp + rng.normal(0, 0.1), 2))
    return Vitals(hr=hr, spo2=spo2, sys=sys, dia=dia, temp=temp)
