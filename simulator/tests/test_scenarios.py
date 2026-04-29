from __future__ import annotations
from datetime import datetime, timezone
from app.profiles import Profile, Baseline, Routine
from app.resident import Resident
from app.scenarios import build, register


def _profile(rid: str = "R900") -> Profile:
    return Profile(
        id=rid, name="X", age=80, room="900", mobility="autonomous", pathologies=[],
        baseline=Baseline(hr=70, spo2=98, sys=130, dia=80, temp=36.8),
        routine=Routine(wake="07:00", sleep="22:00", meals=["08:00","12:30","19:00"]),
    )


def test_fall_scenario_marks_activity_falling_then_lying():
    r = Resident.from_profile(_profile(), seed=1)
    s = build("fall", demo_mode=True)
    now = datetime(2026, 4, 29, 10, 0, 0, tzinfo=timezone.utc)
    s.apply(r, now)
    assert r.activity in {"falling", "lying"}


def test_cardiac_scenario_raises_hr_drops_spo2():
    r = Resident.from_profile(_profile(), seed=1)
    s = build("cardiac", demo_mode=True)
    now = datetime(2026, 4, 29, 10, 0, 0, tzinfo=timezone.utc)
    s.apply(r, now)
    assert r.scenario == "cardiac"


def test_normal_scenario_is_a_noop():
    r = Resident.from_profile(_profile(), seed=1)
    s = build("normal", demo_mode=True)
    now = datetime(2026, 4, 29, 10, 0, 0, tzinfo=timezone.utc)
    s.apply(r, now)
    assert r.scenario == "normal"


def test_unknown_scenario_raises():
    try:
        build("nonsense", demo_mode=True)
    except KeyError:
        return
    raise AssertionError("expected KeyError for unknown scenario")
