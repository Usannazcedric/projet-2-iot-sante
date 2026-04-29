from __future__ import annotations
import json
import pytest
import fakeredis.aioredis
from app.storage.redis import RedisCache


@pytest.fixture
async def cache():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield RedisCache(client=client)
    await client.aclose()


async def test_push_ml_window_appends(cache):
    await cache.push_ml_window("R001", {"hr": 72, "spo2": 98, "temp": 36.5, "sys": 120, "dia": 80})
    items = await cache.get_ml_window("R001", limit=10)
    assert len(items) == 1
    assert items[0]["hr"] == 72


async def test_push_ml_window_caps_at_900(cache):
    for i in range(950):
        await cache.push_ml_window("R002", {"hr": 60 + (i % 30), "spo2": 97, "temp": 36.5, "sys": 120, "dia": 80})
    items = await cache.get_ml_window("R002", limit=10000)
    assert len(items) == 900


async def test_get_ml_window_empty_returns_empty(cache):
    items = await cache.get_ml_window("R999", limit=10)
    assert items == []
