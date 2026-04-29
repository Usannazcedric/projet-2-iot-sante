from __future__ import annotations
from app.ml.trend import score


def _flat(n=60, hr=72, spo2=98, temp=36.5):
    return [{"hr": hr, "spo2": spo2, "sys": 120, "dia": 80, "temp": temp} for _ in range(n)]


def test_flat_window_low_score():
    s = score(_flat())
    assert 0.0 <= s < 0.2


def test_short_window_returns_zero():
    s = score([{"hr": 72, "spo2": 98, "sys": 120, "dia": 80, "temp": 36.5}] * 5)
    assert s == 0.0


def test_empty_returns_zero():
    assert score([]) == 0.0


def test_hr_climbing_high_score():
    # Window in newest-first order (LPUSH semantics): index 0 is most recent.
    win = [{"hr": 110 - i, "spo2": 97, "sys": 130, "dia": 85, "temp": 36.7} for i in range(60)]
    assert score(win) > 0.4


def test_spo2_falling_high_score():
    win = [{"hr": 75, "spo2": 88 + i * 0.1, "sys": 120, "dia": 80, "temp": 36.5} for i in range(60)]
    assert score(win) > 0.4


def test_temp_rising_high_score():
    win = [{"hr": 75, "spo2": 97, "sys": 120, "dia": 80, "temp": 39.0 - i * 0.03} for i in range(60)]
    assert score(win) > 0.3
