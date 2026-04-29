from __future__ import annotations
import os
import joblib
import numpy as np
import pytest
from app.ml.bootstrap import synth_dataset, train_model, FEATURES


def test_synth_dataset_shape():
    arr = synth_dataset("R001", days=1)
    assert arr.shape[1] == len(FEATURES)
    assert arr.shape[0] >= 1000  # at least 1 sample/min for 1 day


def test_synth_dataset_deterministic_per_resident():
    a = synth_dataset("R001", days=1)
    b = synth_dataset("R001", days=1)
    np.testing.assert_array_equal(a, b)


def test_synth_dataset_differs_between_residents():
    a = synth_dataset("R001", days=1)
    b = synth_dataset("R002", days=1)
    assert not np.array_equal(a, b)


def test_train_model_persists_joblib(tmp_path):
    model_path = train_model("R007", str(tmp_path), days=1)
    assert os.path.exists(model_path)
    model = joblib.load(model_path)
    sample = np.array([[72.0, 98.0, 120.0, 80.0, 36.5]])
    pred = model.decision_function(sample)
    assert pred.shape == (1,)


def test_train_model_loads_existing(tmp_path):
    p1 = train_model("R005", str(tmp_path), days=1)
    mtime1 = os.path.getmtime(p1)
    p2 = train_model("R005", str(tmp_path), days=1, force=False)
    assert p1 == p2
    assert os.path.getmtime(p2) == mtime1  # not retrained
