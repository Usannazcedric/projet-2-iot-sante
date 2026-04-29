from __future__ import annotations
import json
from unittest.mock import AsyncMock, MagicMock
import pytest
import fakeredis.aioredis
from app.storage.redis import RedisCache
from app.ingest.handlers import handle


@pytest.fixture
async def cache():
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield RedisCache(client=fake)
    await fake.aclose()


@pytest.fixture
def influx():
    w = MagicMock()
    w.write_vitals = AsyncMock()
    w.write_motion = AsyncMock()
    return w


async def test_vitals_handler_writes_redis_and_influx(cache, influx):
    payload = json.dumps({
        "timestamp": "2026-04-29T10:00:00.000Z",
        "resident_id": "R007",
        "values": {"hr": 78, "spo2": 96, "sys": 132, "dia": 80, "temp": 36.8},
        "seq": 1,
    })
    await handle("vitals", "R007", payload, cache, influx)
    state = await cache.get_resident_state("R007")
    assert state and state["vitals"]["hr"] == 78
    assert state["last_seen"] == "2026-04-29T10:00:00.000Z"
    influx.write_vitals.assert_awaited_once()


async def test_motion_handler_writes_redis_and_influx(cache, influx):
    payload = json.dumps({
        "timestamp": "2026-04-29T10:00:00.000Z",
        "resident_id": "R007",
        "values": {"ax": 0.0, "ay": 9.8, "az": 0.0, "activity": "lying"},
        "seq": 1,
    })
    await handle("motion", "R007", payload, cache, influx)
    state = await cache.get_resident_state("R007")
    assert state["motion"]["activity"] == "lying"
    influx.write_motion.assert_awaited_once()


async def test_invalid_payload_does_not_crash(cache, influx):
    await handle("vitals", "R007", "{not-json", cache, influx)
    assert await cache.get_resident_state("R007") is None
    influx.write_vitals.assert_not_awaited()


async def test_unknown_family_is_ignored(cache, influx):
    await handle("ambient", "101", '{"timestamp":"x","values":{},"seq":1}', cache, influx)
    influx.write_vitals.assert_not_awaited()
    influx.write_motion.assert_not_awaited()
