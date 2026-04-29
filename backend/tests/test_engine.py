from __future__ import annotations
import pytest
import fakeredis.aioredis
from unittest.mock import AsyncMock, MagicMock
from app.alerts.store import AlertStore
from app.alerts.engine import AlertEngine


@pytest.fixture
async def deps():
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    influx = MagicMock()
    influx.write_alert = AsyncMock()
    store = AlertStore(fake, influx)
    publisher = MagicMock()
    publisher.publish_new = AsyncMock()
    publisher.publish_update = AsyncMock()
    escalation = MagicMock()
    escalation.schedule = MagicMock()
    escalation.cancel = MagicMock()
    engine = AlertEngine(store=store, publisher=publisher, escalation=escalation)
    yield engine, store, publisher, escalation
    await fake.aclose()


async def test_no_alert_when_state_normal(deps):
    engine, store, pub, _esc = deps
    state = {
        "vitals": {"hr": 72, "spo2": 97, "sys": 130, "dia": 80, "temp": 36.8},
        "motion": {"ax": 0, "ay": 9.8, "az": 0, "activity": "walking"},
        "last_seen": "x",
    }
    await engine.evaluate_resident("R001", state)
    assert (await store.get_active_for_resident("R001")) is None
    pub.publish_new.assert_not_awaited()


async def test_creates_new_alert_on_first_trigger(deps):
    engine, store, pub, esc = deps
    state = {
        "vitals": {"hr": 72, "spo2": 91, "sys": 130, "dia": 80, "temp": 36.8},  # ALERTE
        "motion": {"activity": "walking"},
        "last_seen": "x",
    }
    await engine.evaluate_resident("R001", state)
    a = await store.get_active_for_resident("R001")
    assert a is not None
    assert a.level == 3
    pub.publish_new.assert_awaited_once()
    esc.schedule.assert_called_once()


async def test_escalates_when_level_increases(deps):
    engine, store, pub, esc = deps
    s_attn = {"vitals": {"hr": 110, "spo2": 97, "sys": 130, "dia": 80, "temp": 36.8}, "motion": {"activity": "walking"}, "last_seen": "x"}
    s_urg = {"vitals": {"hr": 150, "spo2": 97, "sys": 130, "dia": 80, "temp": 36.8}, "motion": {"activity": "walking"}, "last_seen": "x"}
    await engine.evaluate_resident("R001", s_attn)
    pub.publish_new.assert_awaited_once()
    await engine.evaluate_resident("R001", s_urg)
    a = await store.get_active_for_resident("R001")
    assert a.level == 4
    pub.publish_update.assert_awaited_once()


async def test_does_not_downgrade_active_alert(deps):
    engine, store, pub, _esc = deps
    s_urg = {"vitals": {"hr": 150, "spo2": 97, "sys": 130, "dia": 80, "temp": 36.8}, "motion": {"activity": "walking"}, "last_seen": "x"}
    s_normal = {"vitals": {"hr": 72, "spo2": 97, "sys": 130, "dia": 80, "temp": 36.8}, "motion": {"activity": "walking"}, "last_seen": "x"}
    await engine.evaluate_resident("R001", s_urg)
    await engine.evaluate_resident("R001", s_normal)
    a = await store.get_active_for_resident("R001")
    assert a is not None
    assert a.level == 4  # sticky
