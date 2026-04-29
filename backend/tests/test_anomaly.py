from __future__ import annotations
import pytest
import numpy as np
from app.ml.bootstrap import train_model
from app.ml.anomaly import score


def test_score_normal_window_low(tmp_path):
    train_model("R001", str(tmp_path), days=1)
    window = [{"hr": 72, "spo2": 98, "sys": 120, "dia": 80, "temp": 36.5}] * 30
    s = score("R001", window, str(tmp_path))
    assert 0.0 <= s <= 1.0
    assert s < 0.5  # baseline values ~ normal


def test_score_anomalous_window_high(tmp_path):
    train_model("R002", str(tmp_path), days=1)
    window = [{"hr": 180, "spo2": 70, "sys": 200, "dia": 130, "temp": 39.5}] * 30
    s = score("R002", window, str(tmp_path))
    assert s > 0.5


def test_score_empty_window_zero(tmp_path):
    train_model("R003", str(tmp_path), days=1)
    s = score("R003", [], str(tmp_path))
    assert s == 0.0


def test_score_no_model_returns_zero(tmp_path):
    s = score("R999", [{"hr": 72, "spo2": 98, "sys": 120, "dia": 80, "temp": 36.5}], str(tmp_path))
    assert s == 0.0
