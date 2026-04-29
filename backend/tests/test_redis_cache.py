from __future__ import annotations
import pytest
import fakeredis.aioredis
from app.storage.redis import RedisCache


@pytest.fixture
async def cache():
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    c = RedisCache(client=fake)
    yield c
    await fake.aclose()


async def test_set_and_get_resident_state(cache):
    await cache.set_resident_state("R001", {"hr": 75, "spo2": 97})
    state = await cache.get_resident_state("R001")
    assert state == {"hr": 75, "spo2": 97}


async def test_state_returns_none_when_missing(cache):
    assert await cache.get_resident_state("R999") is None


async def test_list_residents_returns_all_known_ids(cache):
    await cache.set_resident_state("R001", {"x": 1})
    await cache.set_resident_state("R002", {"x": 2})
    ids = sorted(await cache.list_residents())
    assert ids == ["R001", "R002"]


async def test_set_state_uses_ttl(cache):
    await cache.set_resident_state("R001", {"hr": 70})
    ttl = await cache.client.ttl("state:resident:R001")
    assert 0 < ttl <= 60
