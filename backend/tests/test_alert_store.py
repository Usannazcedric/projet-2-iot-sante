from __future__ import annotations
import pytest
import fakeredis.aioredis
from unittest.mock import AsyncMock, MagicMock
from app.alerts.store import AlertStore
from app.models import AlertLevel


@pytest.fixture
async def redis():
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield fake
    await fake.aclose()


@pytest.fixture
def influx():
    w = MagicMock()
    w.write_alert = AsyncMock()
    return w


@pytest.fixture
async def store(redis, influx):
    return AlertStore(redis, influx)


async def test_create_adds_to_active_set_and_writes_audit(store, redis, influx):
    a = await store.create("R001", AlertLevel.ALERTE, "spo2 low")
    assert a.resident_id == "R001"
    assert a.level == 3
    members = await redis.smembers("alerts:active")
    assert a.id in members
    influx.write_alert.assert_awaited_once()


async def test_get_returns_alert(store):
    a = await store.create("R001", AlertLevel.ATTENTION, "hr elevated")
    fetched = await store.get(a.id)
    assert fetched is not None
    assert fetched.id == a.id


async def test_list_active_returns_all(store):
    a1 = await store.create("R001", AlertLevel.ATTENTION, "x")
    a2 = await store.create("R002", AlertLevel.URGENCE, "y")
    ids = sorted(x.id for x in await store.list_active())
    assert sorted([a1.id, a2.id]) == ids


async def test_update_level_persists_and_audits(store, influx):
    a = await store.create("R001", AlertLevel.ATTENTION, "hr")
    influx.write_alert.reset_mock()
    updated = await store.update_level(a.id, AlertLevel.ALERTE, "escalation")
    assert updated.level == 3
    fetched = await store.get(a.id)
    assert fetched.level == 3
    influx.write_alert.assert_awaited_once()


async def test_set_status_resolved_removes_from_active(store, redis):
    a = await store.create("R001", AlertLevel.ATTENTION, "x")
    await store.set_status(a.id, "resolved")
    members = await redis.smembers("alerts:active")
    assert a.id not in members
    fetched = await store.get(a.id)
    assert fetched.status == "resolved"


async def test_set_status_acknowledged_keeps_in_active(store, redis):
    a = await store.create("R001", AlertLevel.URGENCE, "x")
    await store.set_status(a.id, "acknowledged")
    members = await redis.smembers("alerts:active")
    assert a.id in members
    assert (await store.get(a.id)).status == "acknowledged"


async def test_get_active_for_resident_returns_one(store):
    a = await store.create("R001", AlertLevel.ATTENTION, "x")
    found = await store.get_active_for_resident("R001")
    assert found is not None and found.id == a.id


async def test_get_active_for_resident_returns_none_when_resolved(store):
    a = await store.create("R001", AlertLevel.ATTENTION, "x")
    await store.set_status(a.id, "resolved")
    assert await store.get_active_for_resident("R001") is None
