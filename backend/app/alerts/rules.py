from __future__ import annotations
from typing import Optional, Tuple
from ..models import AlertLevel


def evaluate(state: dict) -> Optional[Tuple[AlertLevel, str]]:
    """Evaluate a resident state snapshot against threshold rules.

    Returns (level, reason) for the highest matching level, or None.
    """
    vitals = state.get("vitals") or {}
    motion = state.get("motion") or {}
    risk = state.get("risk")

    hr = vitals.get("hr")
    spo2 = vitals.get("spo2")
    sys_p = vitals.get("sys")
    dia = vitals.get("dia")
    temp = vitals.get("temp")
    activity = motion.get("activity")

    # L5 — Danger vital: critical vitals + immobile/lying
    if (
        hr is not None and spo2 is not None and sys_p is not None
        and (hr < 40 or hr > 160)
        and spo2 < 85
        and activity in ("lying", "still", None)
    ):
        return AlertLevel.DANGER_VITAL, "critical vitals + immobile"

    # L4 — Urgence: fall pattern OR critical HR/SpO2 alone
    if activity == "fall":
        return AlertLevel.URGENCE, "fall detected"
    if hr is not None and (hr < 40 or hr > 140):
        return AlertLevel.URGENCE, f"hr critical ({hr})"
    if spo2 is not None and spo2 < 88:
        return AlertLevel.URGENCE, f"spo2 critical ({spo2})"

    # L3 — Alerte
    if spo2 is not None and spo2 < 93:
        return AlertLevel.ALERTE, f"spo2 low ({spo2})"
    if risk is not None and risk > 0.6:
        return AlertLevel.ALERTE, f"ml risk {risk:.2f}"

    # L2 — Attention
    if hr is not None and hr > 100:
        return AlertLevel.ATTENTION, f"hr elevated ({hr})"
    if spo2 is not None and 88 <= spo2 < 95:
        return AlertLevel.ATTENTION, f"spo2 borderline ({spo2})"
    if temp is not None and (temp < 35.5 or temp > 37.8):
        return AlertLevel.ATTENTION, f"temp deviation ({temp})"

    # L1 — Information: emit only with explicit signal (e.g. inactivity flag); none here
    return None
