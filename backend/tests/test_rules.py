from __future__ import annotations
from app.alerts.rules import evaluate
from app.models import AlertLevel


def _state(**kwargs) -> dict:
    base = {
        "vitals": {"hr": 72, "spo2": 97, "sys": 130, "dia": 80, "temp": 36.8},
        "motion": {"ax": 0.0, "ay": 9.8, "az": 0.0, "activity": "walking"},
        "last_seen": "2026-04-29T10:00:00.000Z",
    }
    base.update(kwargs)
    return base


def test_normal_state_returns_none():
    assert evaluate(_state()) is None


def test_high_hr_triggers_attention():
    s = _state(vitals={"hr": 110, "spo2": 97, "sys": 130, "dia": 80, "temp": 36.8})
    result = evaluate(s)
    assert result is not None
    level, _ = result
    assert level == AlertLevel.ATTENTION


def test_low_spo2_sustained_triggers_alerte():
    s = _state(vitals={"hr": 72, "spo2": 91, "sys": 130, "dia": 80, "temp": 36.8})
    result = evaluate(s)
    assert result is not None
    level, _ = result
    assert level == AlertLevel.ALERTE


def test_critical_hr_triggers_urgence():
    s = _state(vitals={"hr": 150, "spo2": 97, "sys": 130, "dia": 80, "temp": 36.8})
    result = evaluate(s)
    assert result is not None
    level, _ = result
    assert level == AlertLevel.URGENCE


def test_fall_motion_triggers_urgence():
    s = _state(motion={"ax": 0.0, "ay": 0.0, "az": 0.0, "activity": "fall"})
    result = evaluate(s)
    assert result is not None
    level, _ = result
    assert level == AlertLevel.URGENCE


def test_critical_vitals_no_motion_triggers_danger_vital():
    s = _state(
        vitals={"hr": 35, "spo2": 80, "sys": 60, "dia": 30, "temp": 35.0},
        motion={"ax": 0.0, "ay": 0.0, "az": 0.0, "activity": "lying"},
    )
    result = evaluate(s)
    assert result is not None
    level, _ = result
    assert level == AlertLevel.DANGER_VITAL


def test_ml_risk_above_threshold_triggers_alerte():
    s = _state(risk=0.7)
    result = evaluate(s)
    assert result is not None
    level, _ = result
    assert level == AlertLevel.ALERTE
