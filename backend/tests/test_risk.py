from __future__ import annotations
import json
import pytest
import fakeredis.aioredis
from unittest.mock import AsyncMock, MagicMock
from app.storage.redis import RedisCache
from app.ml.bootstrap import train_model
from app.ml.risk import compute, RiskPublisher


@pytest.fixture
async def cache():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield RedisCache(client=client)
    await client.aclose()


def test_compute_normal(tmp_path):
    train_model("R001", str(tmp_path), days=1)
    window = [{"hr": 72, "spo2": 98, "sys": 120, "dia": 80, "temp": 36.5}] * 30
    out = compute("R001", window, str(tmp_path))
    assert set(out.keys()) == {"anomaly", "trend", "combined"}
    assert 0.0 <= out["combined"] <= 1.0
    assert out["combined"] < 0.5


def test_compute_combiner_weights(tmp_path):
    train_model("R002", str(tmp_path), days=1)
    out = compute("R002", [{"hr": 72, "spo2": 98, "sys": 120, "dia": 80, "temp": 36.5}] * 30, str(tmp_path))
    expected = 0.6 * out["anomaly"] + 0.4 * out["trend"]
    assert abs(out["combined"] - expected) < 1e-6


async def test_publisher_publishes_and_writes(cache, tmp_path):
    train_model("R001", str(tmp_path), days=1)
    for _ in range(30):
        await cache.push_ml_window("R001", {"hr": 72, "spo2": 98, "sys": 120, "dia": 80, "temp": 36.5})
    await cache.set_resident_state("R001", {"resident_id": "R001"})

    mqtt = MagicMock()
    influx = MagicMock()
    influx.write_risk = AsyncMock()
    publisher = RiskPublisher(cache=cache, mqtt=mqtt, influx=influx, models_dir=str(tmp_path))
    await publisher.tick()

    assert mqtt.publish.called
    topic, payload, *_ = mqtt.publish.call_args[0]
    assert topic == "ehpad/risk/resident/R001"
    body = json.loads(payload)
    assert body["resident_id"] == "R001"
    assert "combined" in body
    assert influx.write_risk.await_count == 1

    state = await cache.get_resident_state("R001")
    assert "risk" in state
    assert 0.0 <= state["risk"] <= 1.0


async def test_publisher_skips_residents_without_window(cache, tmp_path):
    await cache.set_resident_state("R005", {"resident_id": "R005"})
    mqtt = MagicMock()
    influx = MagicMock()
    influx.write_risk = AsyncMock()
    publisher = RiskPublisher(cache=cache, mqtt=mqtt, influx=influx, models_dir=str(tmp_path))
    await publisher.tick()
    assert not mqtt.publish.called
    assert not influx.write_risk.called
