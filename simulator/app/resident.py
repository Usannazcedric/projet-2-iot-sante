from __future__ import annotations
import itertools
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
import numpy as np
from .profiles import Profile
from .sensors import vitals as vitals_mod
from .sensors import motion as motion_mod


@dataclass
class Resident:
    profile: Profile
    rng: np.random.Generator
    seq_vitals: itertools.count = field(default_factory=lambda: itertools.count(1))
    seq_motion: itertools.count = field(default_factory=lambda: itertools.count(1))
    activity: str = "idle"
    scenario: str = "normal"

    @classmethod
    def from_profile(cls, profile: Profile, seed: int | None = None) -> "Resident":
        rng = np.random.default_rng(seed)
        return cls(profile=profile, rng=rng)

    def tick(self, now: datetime) -> dict[str, Any]:
        v = vitals_mod.generate(self.profile, self.activity, self.rng)
        ts = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return {
            "timestamp": ts,
            "resident_id": self.profile.id,
            "values": dict(v),
            "vitals": dict(v),
            "seq": next(self.seq_vitals),
        }

    def tick_motion(self, now: datetime) -> dict[str, Any]:
        a = motion_mod.generate(self.activity, self.rng)
        ts = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return {
            "timestamp": ts,
            "resident_id": self.profile.id,
            "values": dict(a),
            "seq": next(self.seq_motion),
        }
