from __future__ import annotations
import itertools
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
import numpy as np
from .profiles import Profile


@dataclass
class Resident:
    profile: Profile
    rng: np.random.Generator
    seq: itertools.count = field(default_factory=lambda: itertools.count(1))
    activity: str = "idle"
    scenario: str = "normal"

    @classmethod
    def from_profile(cls, profile: Profile, seed: int | None = None) -> "Resident":
        rng = np.random.default_rng(seed)
        return cls(profile=profile, rng=rng)

    def tick(self, now: datetime) -> dict[str, Any]:
        b = self.profile.baseline
        hr = int(b.hr + self.rng.normal(0, 3))
        spo2 = int(np.clip(b.spo2 + self.rng.normal(0, 1), 90, 100))
        sys = int(b.sys + self.rng.normal(0, 4))
        dia = int(b.dia + self.rng.normal(0, 3))
        if dia > sys - 20:
            dia = sys - 20
        temp = float(round(b.temp + self.rng.normal(0, 0.1), 2))
        return {
            "timestamp": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "resident_id": self.profile.id,
            "values": {"hr": hr, "spo2": spo2, "sys": sys, "dia": dia, "temp": temp},
            "vitals": {"hr": hr, "spo2": spo2, "sys": sys, "dia": dia, "temp": temp},
            "seq": next(self.seq),
        }
