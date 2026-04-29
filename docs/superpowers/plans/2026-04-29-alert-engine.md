# Alert Engine + Auto-Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5-level alert engine to the EHPAD backend. Threshold rules over the latest resident state in Redis emit Information/Attention/Alerte/Urgence/Danger vital alerts. Per-alert escalation timers upgrade unacked alerts (DEMO_MODE compresses delays). Alerts persist in Redis (active set) and InfluxDB (audit), publish to MQTT (`ehpad/alerts/*`), and expose REST endpoints (list, ack, resolve).

**Architecture:** Three new modules: `alerts/rules.py` (pure functions, no I/O — easiest unit), `alerts/store.py` (Redis active set + Influx audit append), `alerts/engine.py` (1 Hz loop reading state, evaluating rules, comparing against active alert, persisting + publishing). A separate `alerts/escalation.py` schedules per-alert asyncio tasks that bump the level after a deadline; ack/resolve cancels. The MQTT publisher reuses the existing paho client (introduced in this plan) to publish on `ehpad/alerts/new` and `ehpad/alerts/update/<id>`. REST adds `app/api/alerts.py`. Out of scope: ML risk score (sub-project 7) — engine reads `state.risk` if present, falls back to threshold-only otherwise.

**Tech Stack:** Continue Python 3.12, FastAPI, paho-mqtt 2.x, redis-py asyncio, influxdb-client, pydantic 2.x, structlog, asyncio. No new prod deps.

---

## Reference

- Design spec: `docs/superpowers/specs/2026-04-29-ehpad-monitoring-design.md` — §4 alert MQTT topics + QoS 1, §6.1 5-level rules table, §6.2 auto-escalation deadlines + DEMO_MODE compression, §7 storage layout (Redis `alerts:active` SET + key `alerts:detail:<id>`, Influx `alerts` measurement).
- Build order: step 4 of 8.
- Out of scope for this plan: ws-gateway (5), frontend (6), ML risk publisher (7), final docs polish (8). Engine consumes `state.risk` if present, gracefully ignores absence.

## File Structure

```
backend/
├── app/
│   ├── alerts/
│   │   ├── __init__.py
│   │   ├── rules.py         # threshold rules per level — pure
│   │   ├── store.py         # Redis active set + alert detail + Influx audit
│   │   ├── engine.py        # 1 Hz loop: state → rules → store → publish
│   │   ├── escalation.py    # per-alert asyncio timer manager
│   │   └── publisher.py     # MQTT publish helper (uses ingest MqttClient)
│   ├── api/
│   │   └── alerts.py        # GET /alerts, POST /alerts/{id}/ack, /resolve
│   ├── ingest/
│   │   └── client.py        # MODIFY: expose .publish() helper
│   ├── main.py              # MODIFY: instantiate engine + escalation; mount alerts router
│   ├── config.py            # MODIFY: add demo_mode flag (env DEMO_MODE)
│   └── models.py            # MODIFY: add Alert, AlertLevel
└── tests/
    ├── test_rules.py        # 6 tests — every level + no-trigger
    ├── test_engine.py       # 3 tests — sticky, escalate, ack-clears
    └── test_escalation.py   # 2 tests — schedule fires, cancel works
```

Each unit:
- `rules.py` — `evaluate(state) -> AlertLevel | None` and a richer `evaluate_with_reason(state) -> (AlertLevel, str) | None`. Pure. No Redis. No async.
- `store.py` — `AlertStore` class with `create`, `get`, `list_active`, `update_level`, `set_status`, `delete`. Redis: `alerts:active` SET of ids; `alerts:detail:<id>` JSON (no TTL). Influx: append point per state change to measurement `alerts`.
- `engine.py` — `AlertEngine.evaluate_resident(resident_id, state)`: evaluate rules → if no active alert and rules emit a level, create + publish "new"; if active and new level > current, update + publish "update"; if active and equal, refresh `last_seen`; if rules emit None, leave active alert alone (sticky). `loop()`: every 1 s, scan all known residents, call `evaluate_resident`.
- `escalation.py` — `EscalationManager.schedule(alert_id, level, on_escalate)`: spawn asyncio task that sleeps the delay then calls callback with new level. `cancel(alert_id)` on ack/resolve. Deadlines: L2→L3 600 s, L3→L4 300 s, L4→L5 180 s. DEMO_MODE divides by 10.
- `publisher.py` — thin wrapper exposing `publish_new(alert)` and `publish_update(alert)` over MqttClient.
- `alerts.py` (api) — REST endpoints. `POST .../ack` cancels escalation timer + sets status=`acknowledged`. `POST .../resolve` cancels timer + status=`resolved` + removes from `alerts:active` set.
- `main.py` modifications: add lifespan steps to start engine loop and stop on shutdown.

---

## Pre-Flight

- [ ] **Step 0.1: Confirm directory + branch**

Run: `pwd && git branch --show-current`

Expected: dir ends with `/projet 2 iot Santé`. Branch `alert-engine`.

- [ ] **Step 0.2: Reuse existing venv**

```bash
cd "backend" && source .venv/bin/activate && python3 -m pytest -v 2>&1 | tail -5
```

Expected: 13 passed (baseline from sub-project 3).

- [ ] **Step 0.3: Confirm existing stack still healthy (optional, for smoke phase only)**

```bash
docker compose up -d
sleep 30
docker compose ps
```

Expected: 5 services healthy. Tear down at end of plan.

---

## Task 1: Skeleton + models + config

**Files:**
- Create: `backend/app/alerts/__init__.py` (empty)
- Modify: `backend/app/models.py`
- Modify: `backend/app/config.py`

- [ ] **Step 1.1: Create `backend/app/alerts/__init__.py`** — empty file (zero bytes).

- [ ] **Step 1.2: Append to `backend/app/models.py`**

Append at the end of the existing file (do not delete existing classes). The file must keep `VitalsValues`, `MotionValues`, `VitalsPayload`, `MotionPayload`, `AmbientPayload`, `ResidentSnapshot`. Add:

```python
from enum import IntEnum


class AlertLevel(IntEnum):
    INFORMATION = 1
    ATTENTION = 2
    ALERTE = 3
    URGENCE = 4
    DANGER_VITAL = 5


class AlertStatus(BaseModel):
    pass


class Alert(BaseModel):
    id: str
    resident_id: str
    level: int  # 1..5
    reason: str
    status: str = "active"  # active | acknowledged | resolved
    created_at: str
    updated_at: str
    last_seen: str
```

Keep imports at the top of `models.py` (`from enum import IntEnum` goes alongside the existing imports). Ensure no duplicate definitions.

- [ ] **Step 1.3: Modify `backend/app/config.py`**

Add a `demo_mode: bool` field to `Settings`. Update `from_env` to read `DEMO_MODE` env var (truthy if "true"/"1", default `False`). Final state should be:

```python
from __future__ import annotations
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    mqtt_host: str
    mqtt_port: int
    redis_url: str
    influx_url: str
    influx_token: str
    influx_org: str
    influx_bucket: str
    api_port: int
    log_level: str
    demo_mode: bool

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            mqtt_host=os.getenv("MQTT_HOST", "mosquitto"),
            mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
            redis_url=os.getenv("REDIS_URL", "redis://redis:6379"),
            influx_url=os.getenv("INFLUX_URL", "http://influxdb:8086"),
            influx_token=os.getenv("INFLUX_TOKEN", "ehpad-token-dev"),
            influx_org=os.getenv("INFLUX_ORG", "ehpad"),
            influx_bucket=os.getenv("INFLUX_BUCKET", "ehpad_vitals"),
            api_port=int(os.getenv("API_PORT", "8000")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            demo_mode=os.getenv("DEMO_MODE", "false").lower() in ("1", "true", "yes"),
        )
```

- [ ] **Step 1.4: Verify import + tests still green**

```bash
cd "backend" && source .venv/bin/activate
python3 -c "from app.models import Alert, AlertLevel; from app.config import Settings; s=Settings.from_env(); print(s.demo_mode, AlertLevel.URGENCE.value)"
python3 -m pytest -v 2>&1 | tail -5
```

Expected: prints `False 4`. 13 tests still pass.

- [ ] **Step 1.5: Commit**

```bash
git add backend/app/alerts/__init__.py backend/app/models.py backend/app/config.py
git commit -m "feat(backend): alert package skeleton, AlertLevel enum, Alert model, DEMO_MODE config"
```

---

## Task 2: Threshold rules (TDD)

**Files:**
- Create: `backend/tests/test_rules.py`
- Create: `backend/app/alerts/rules.py`

The rules module is pure (no I/O, no Redis, no async) — perfect TDD target.

- [ ] **Step 2.1: Write failing tests first**

File `backend/tests/test_rules.py`:

```python
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
```

- [ ] **Step 2.2: Run failing test (RED)**

```bash
cd "backend" && source .venv/bin/activate && python3 -m pytest tests/test_rules.py -v
```

Expected: ImportError on `from app.alerts.rules import evaluate`.

- [ ] **Step 2.3: Implement rules**

File `backend/app/alerts/rules.py`:

```python
from __future__ import annotations
from typing import Optional, Tuple
from ..models import AlertLevel


def evaluate(state: dict) -> Optional[Tuple[AlertLevel, str]]:
    """Evaluate a resident state snapshot against threshold rules.

    Returns (level, reason) for the highest matching level, or None.
    """
    vitals = state.get("vitals") or {}
    motion = state.get("motion") or {}
    risk = state.get("risk")

    hr = vitals.get("hr")
    spo2 = vitals.get("spo2")
    sys_p = vitals.get("sys")
    dia = vitals.get("dia")
    temp = vitals.get("temp")
    activity = motion.get("activity")

    # L5 — Danger vital: critical vitals + immobile/lying
    if (
        hr is not None and spo2 is not None and sys_p is not None
        and (hr < 40 or hr > 160)
        and spo2 < 85
        and activity in ("lying", "still", None)
    ):
        return AlertLevel.DANGER_VITAL, "critical vitals + immobile"

    # L4 — Urgence: fall pattern OR critical HR/SpO2 alone
    if activity == "fall":
        return AlertLevel.URGENCE, "fall detected"
    if hr is not None and (hr < 40 or hr > 140):
        return AlertLevel.URGENCE, f"hr critical ({hr})"
    if spo2 is not None and spo2 < 88:
        return AlertLevel.URGENCE, f"spo2 critical ({spo2})"

    # L3 — Alerte
    if spo2 is not None and spo2 < 93:
        return AlertLevel.ALERTE, f"spo2 low ({spo2})"
    if risk is not None and risk > 0.6:
        return AlertLevel.ALERTE, f"ml risk {risk:.2f}"

    # L2 — Attention
    if hr is not None and hr > 100:
        return AlertLevel.ATTENTION, f"hr elevated ({hr})"
    if spo2 is not None and 88 <= spo2 < 95:
        return AlertLevel.ATTENTION, f"spo2 borderline ({spo2})"
    if temp is not None and (temp < 35.5 or temp > 37.8):
        return AlertLevel.ATTENTION, f"temp deviation ({temp})"

    # L1 — Information: emit only with explicit signal (e.g. inactivity flag); none here
    return None
```

- [ ] **Step 2.4: Re-run tests (GREEN)**

```bash
cd "backend" && source .venv/bin/activate && python3 -m pytest tests/test_rules.py -v
```

Expected: 7 passed. (6 named explicitly above + the ml risk one — total 7.)

- [ ] **Step 2.5: Run full suite (no regression)**

```bash
python3 -m pytest -v 2>&1 | tail -5
```

Expected: 20 passed (13 previous + 7 rules).

- [ ] **Step 2.6: Commit**

```bash
git add backend/app/alerts/rules.py backend/tests/test_rules.py
git commit -m "feat(backend): alert threshold rules (5 levels) with TDD"
```

---

## Task 3: AlertStore (Redis + Influx audit)

**Files:**
- Create: `backend/app/alerts/store.py`
- Create: `backend/tests/test_alert_store.py`

- [ ] **Step 3.1: Write failing tests first**

File `backend/tests/test_alert_store.py`:

```python
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
```

- [ ] **Step 3.2: Run failing test (RED)**

```bash
cd "backend" && source .venv/bin/activate && python3 -m pytest tests/test_alert_store.py -v
```

Expected: ImportError on `AlertStore`.

- [ ] **Step 3.3: Add `write_alert` method to InfluxWriter**

Modify `backend/app/storage/influx.py` — append a new method on `InfluxWriter`:

```python
    async def write_alert(self, alert_id: str, resident_id: str, level: int, status: str, reason: str, ts: str) -> None:
        p = (
            Point("alerts")
            .tag("resident_id", resident_id)
            .tag("alert_id", alert_id)
            .tag("status", status)
            .field("level", int(level))
            .field("reason", str(reason))
            .time(ts)
        )
        await asyncio.to_thread(self._write.write, bucket=self.bucket, org=self.org, record=p)
```

Place this method below `write_motion` and before `query_history`. Do not modify any other methods.

- [ ] **Step 3.4: Implement AlertStore**

File `backend/app/alerts/store.py`:

```python
from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
import redis.asyncio as aioredis
from ..models import Alert, AlertLevel
from ..logging import get_logger

log = get_logger("backend.alerts.store")

ACTIVE_SET = "alerts:active"
DETAIL_KEY = "alerts:detail:{id}"
RESIDENT_INDEX = "alerts:by_resident:{resident_id}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AlertStore:
    def __init__(self, redis: aioredis.Redis, influx: Any) -> None:
        self.redis = redis
        self.influx = influx

    async def create(self, resident_id: str, level: AlertLevel, reason: str) -> Alert:
        alert_id = uuid.uuid4().hex
        now = _now_iso()
        alert = Alert(
            id=alert_id,
            resident_id=resident_id,
            level=int(level),
            reason=reason,
            status="active",
            created_at=now,
            updated_at=now,
            last_seen=now,
        )
        await self.redis.set(DETAIL_KEY.format(id=alert_id), alert.model_dump_json())
        await self.redis.sadd(ACTIVE_SET, alert_id)
        await self.redis.set(RESIDENT_INDEX.format(resident_id=resident_id), alert_id)
        await self.influx.write_alert(alert_id, resident_id, int(level), "active", reason, now)
        return alert

    async def get(self, alert_id: str) -> Optional[Alert]:
        raw = await self.redis.get(DETAIL_KEY.format(id=alert_id))
        if raw is None:
            return None
        return Alert.model_validate_json(raw)

    async def list_active(self) -> list[Alert]:
        ids = list(await self.redis.smembers(ACTIVE_SET))
        out: list[Alert] = []
        for aid in ids:
            a = await self.get(aid)
            if a is not None:
                out.append(a)
        return out

    async def get_active_for_resident(self, resident_id: str) -> Optional[Alert]:
        aid = await self.redis.get(RESIDENT_INDEX.format(resident_id=resident_id))
        if aid is None:
            return None
        a = await self.get(aid)
        if a is None or a.status == "resolved":
            return None
        return a

    async def update_level(self, alert_id: str, level: AlertLevel, reason: str) -> Optional[Alert]:
        a = await self.get(alert_id)
        if a is None:
            return None
        a.level = int(level)
        a.reason = reason
        a.updated_at = _now_iso()
        a.last_seen = a.updated_at
        await self.redis.set(DETAIL_KEY.format(id=alert_id), a.model_dump_json())
        await self.influx.write_alert(a.id, a.resident_id, a.level, a.status, a.reason, a.updated_at)
        return a

    async def refresh(self, alert_id: str) -> None:
        a = await self.get(alert_id)
        if a is None:
            return
        a.last_seen = _now_iso()
        await self.redis.set(DETAIL_KEY.format(id=alert_id), a.model_dump_json())

    async def set_status(self, alert_id: str, status: str) -> Optional[Alert]:
        if status not in ("active", "acknowledged", "resolved"):
            raise ValueError(f"invalid status: {status}")
        a = await self.get(alert_id)
        if a is None:
            return None
        a.status = status
        a.updated_at = _now_iso()
        await self.redis.set(DETAIL_KEY.format(id=alert_id), a.model_dump_json())
        if status == "resolved":
            await self.redis.srem(ACTIVE_SET, alert_id)
            await self.redis.delete(RESIDENT_INDEX.format(resident_id=a.resident_id))
        await self.influx.write_alert(a.id, a.resident_id, a.level, a.status, a.reason, a.updated_at)
        return a
```

- [ ] **Step 3.5: Re-run tests (GREEN)**

```bash
cd "backend" && source .venv/bin/activate && python3 -m pytest tests/test_alert_store.py -v
```

Expected: 8 passed.

- [ ] **Step 3.6: Run full suite**

```bash
python3 -m pytest -v 2>&1 | tail -5
```

Expected: 28 passed (20 + 8).

- [ ] **Step 3.7: Commit**

```bash
git add backend/app/storage/influx.py backend/app/alerts/store.py backend/tests/test_alert_store.py
git commit -m "feat(backend): AlertStore (Redis active set + Influx audit) with TDD"
```

---

## Task 4: Engine (TDD)

**Files:**
- Create: `backend/app/alerts/engine.py`
- Create: `backend/tests/test_engine.py`

- [ ] **Step 4.1: Write failing tests first**

File `backend/tests/test_engine.py`:

```python
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
```

- [ ] **Step 4.2: Run failing test (RED)**

```bash
python3 -m pytest tests/test_engine.py -v
```

Expected: ImportError on `AlertEngine`.

- [ ] **Step 4.3: Implement engine**

File `backend/app/alerts/engine.py`:

```python
from __future__ import annotations
import asyncio
from typing import Any
from .rules import evaluate
from .store import AlertStore
from ..logging import get_logger

log = get_logger("backend.alerts.engine")


class AlertEngine:
    def __init__(self, store: AlertStore, publisher: Any, escalation: Any) -> None:
        self.store = store
        self.publisher = publisher
        self.escalation = escalation
        self._running = False

    async def evaluate_resident(self, resident_id: str, state: dict) -> None:
        result = evaluate(state)
        existing = await self.store.get_active_for_resident(resident_id)

        if result is None:
            if existing is not None:
                await self.store.refresh(existing.id)
            return

        new_level, reason = result

        if existing is None:
            alert = await self.store.create(resident_id, new_level, reason)
            await self.publisher.publish_new(alert)
            try:
                self.escalation.schedule(alert.id, alert.level, self._on_escalate)
            except Exception as exc:  # noqa: BLE001
                log.error("schedule_failed", alert_id=alert.id, err=str(exc))
            return

        if int(new_level) > existing.level:
            updated = await self.store.update_level(existing.id, new_level, reason)
            if updated is not None:
                await self.publisher.publish_update(updated)
                try:
                    self.escalation.cancel(existing.id)
                    self.escalation.schedule(updated.id, updated.level, self._on_escalate)
                except Exception as exc:  # noqa: BLE001
                    log.error("reschedule_failed", alert_id=existing.id, err=str(exc))
            return

        # equal or lower → sticky; refresh last_seen
        await self.store.refresh(existing.id)

    async def _on_escalate(self, alert_id: str, new_level: int, reason: str) -> None:
        updated = await self.store.update_level(alert_id, new_level, reason)
        if updated is not None:
            await self.publisher.publish_update(updated)

    async def loop(self, cache, interval: float = 1.0) -> None:
        self._running = True
        while self._running:
            try:
                ids = await cache.list_residents()
                for rid in ids:
                    state = await cache.get_resident_state(rid)
                    if state:
                        await self.evaluate_resident(rid, state)
            except Exception as exc:  # noqa: BLE001
                log.error("loop_iteration_failed", err=str(exc))
            await asyncio.sleep(interval)

    def stop(self) -> None:
        self._running = False
```

- [ ] **Step 4.4: Re-run tests (GREEN)**

```bash
python3 -m pytest tests/test_engine.py -v
```

Expected: 4 passed.

- [ ] **Step 4.5: Full suite check**

```bash
python3 -m pytest -v 2>&1 | tail -5
```

Expected: 32 passed (28 + 4).

- [ ] **Step 4.6: Commit**

```bash
git add backend/app/alerts/engine.py backend/tests/test_engine.py
git commit -m "feat(backend): AlertEngine (sticky, escalate-on-rise) with TDD"
```

---

## Task 5: Escalation timers (TDD)

**Files:**
- Create: `backend/app/alerts/escalation.py`
- Create: `backend/tests/test_escalation.py`

- [ ] **Step 5.1: Write failing tests first**

File `backend/tests/test_escalation.py`:

```python
from __future__ import annotations
import asyncio
import pytest
from unittest.mock import AsyncMock
from app.alerts.escalation import EscalationManager, escalation_delays


def test_demo_mode_compresses_delays():
    prod = escalation_delays(demo_mode=False)
    demo = escalation_delays(demo_mode=True)
    assert prod[2] == 600
    assert prod[3] == 300
    assert prod[4] == 180
    assert demo[2] == 60
    assert demo[3] == 30
    assert demo[4] == 18


async def test_schedule_fires_after_delay_demo_mode_short():
    callback = AsyncMock()
    manager = EscalationManager(demo_mode=True)
    # Override delay map for fast test
    manager._delays = {2: 0.05, 3: 0.05, 4: 0.05}
    manager.schedule("alert-1", 2, callback)
    await asyncio.sleep(0.15)
    callback.assert_awaited_once()
    args = callback.await_args
    assert args.args[0] == "alert-1"
    assert args.args[1] == 3  # escalated to L3


async def test_cancel_prevents_callback():
    callback = AsyncMock()
    manager = EscalationManager(demo_mode=True)
    manager._delays = {2: 0.1, 3: 0.1, 4: 0.1}
    manager.schedule("alert-1", 2, callback)
    manager.cancel("alert-1")
    await asyncio.sleep(0.2)
    callback.assert_not_awaited()


async def test_no_schedule_for_max_level():
    callback = AsyncMock()
    manager = EscalationManager(demo_mode=True)
    manager._delays = {2: 0.05, 3: 0.05, 4: 0.05}
    manager.schedule("alert-1", 5, callback)
    await asyncio.sleep(0.1)
    callback.assert_not_awaited()


async def test_schedule_replaces_existing_timer():
    callback = AsyncMock()
    manager = EscalationManager(demo_mode=True)
    manager._delays = {2: 0.2, 3: 0.05, 4: 0.05}
    manager.schedule("alert-1", 2, callback)
    # Replace with L3 timer (faster)
    manager.schedule("alert-1", 3, callback)
    await asyncio.sleep(0.1)
    callback.assert_awaited_once()
    args = callback.await_args
    assert args.args[1] == 4  # L3 -> L4
```

- [ ] **Step 5.2: Run failing test (RED)**

```bash
python3 -m pytest tests/test_escalation.py -v
```

Expected: ImportError on `EscalationManager`.

- [ ] **Step 5.3: Implement escalation**

File `backend/app/alerts/escalation.py`:

```python
from __future__ import annotations
import asyncio
from typing import Awaitable, Callable, Dict
from ..logging import get_logger

log = get_logger("backend.alerts.escalation")


PROD_DELAYS: Dict[int, float] = {2: 600.0, 3: 300.0, 4: 180.0}


def escalation_delays(demo_mode: bool) -> Dict[int, float]:
    if demo_mode:
        return {k: v / 10.0 for k, v in PROD_DELAYS.items()}
    return dict(PROD_DELAYS)


EscalateCallback = Callable[[str, int, str], Awaitable[None]]


class EscalationManager:
    def __init__(self, demo_mode: bool = False) -> None:
        self.demo_mode = demo_mode
        self._delays = escalation_delays(demo_mode)
        self._tasks: Dict[str, asyncio.Task] = {}

    def schedule(self, alert_id: str, current_level: int, callback: EscalateCallback) -> None:
        if current_level >= 5:
            return
        delay = self._delays.get(int(current_level))
        if delay is None:
            return
        # Replace any existing timer for this alert
        self.cancel(alert_id)
        next_level = int(current_level) + 1

        async def _runner() -> None:
            try:
                await asyncio.sleep(delay)
                reason = f"auto-escalated L{current_level}->L{next_level} (unacked)"
                await callback(alert_id, next_level, reason)
            except asyncio.CancelledError:
                return
            except Exception as exc:  # noqa: BLE001
                log.error("escalation_callback_failed", alert_id=alert_id, err=str(exc))
            finally:
                self._tasks.pop(alert_id, None)

        task = asyncio.create_task(_runner())
        self._tasks[alert_id] = task

    def cancel(self, alert_id: str) -> None:
        task = self._tasks.pop(alert_id, None)
        if task is not None and not task.done():
            task.cancel()

    def cancel_all(self) -> None:
        for aid in list(self._tasks.keys()):
            self.cancel(aid)
```

- [ ] **Step 5.4: Re-run tests (GREEN)**

```bash
python3 -m pytest tests/test_escalation.py -v
```

Expected: 5 passed.

- [ ] **Step 5.5: Full suite**

```bash
python3 -m pytest -v 2>&1 | tail -5
```

Expected: 37 passed (32 + 5).

- [ ] **Step 5.6: Commit**

```bash
git add backend/app/alerts/escalation.py backend/tests/test_escalation.py
git commit -m "feat(backend): EscalationManager with DEMO_MODE compressed delays (TDD)"
```

---

## Task 6: REST + MQTT publisher

**Files:**
- Create: `backend/app/alerts/publisher.py`
- Create: `backend/app/api/alerts.py`
- Modify: `backend/app/ingest/client.py` — add a `publish` helper.

- [ ] **Step 6.1: Add publish helper to MqttClient**

Open `backend/app/ingest/client.py`. After the `stop` method, append:

```python
    def publish(self, topic: str, payload: bytes | str, qos: int = 1) -> None:
        """Publish a retained-friendly message. Safe from any thread."""
        self.client.publish(topic, payload=payload, qos=qos)
```

Do not change any other content. The method body is one line; it relies on paho's internal thread-safe publish.

- [ ] **Step 6.2: Implement alerts publisher**

File `backend/app/alerts/publisher.py`:

```python
from __future__ import annotations
from typing import Any
from ..models import Alert
from ..logging import get_logger

log = get_logger("backend.alerts.publisher")


class AlertPublisher:
    """Wraps the existing MQTT client to publish alert events."""

    def __init__(self, mqtt_client: Any) -> None:
        self._mqtt = mqtt_client

    async def publish_new(self, alert: Alert) -> None:
        try:
            self._mqtt.publish("ehpad/alerts/new", alert.model_dump_json(), qos=1)
        except Exception as exc:  # noqa: BLE001
            log.error("publish_new_failed", alert_id=alert.id, err=str(exc))

    async def publish_update(self, alert: Alert) -> None:
        try:
            self._mqtt.publish(f"ehpad/alerts/update/{alert.id}", alert.model_dump_json(), qos=1)
        except Exception as exc:  # noqa: BLE001
            log.error("publish_update_failed", alert_id=alert.id, err=str(exc))
```

- [ ] **Step 6.3: Implement alerts REST router**

File `backend/app/api/alerts.py`:

```python
from __future__ import annotations
from fastapi import APIRouter, HTTPException
from ..alerts.store import AlertStore


router = APIRouter()
_state: dict[str, object] = {}


def init(store: AlertStore, escalation, publisher) -> None:
    _state["store"] = store
    _state["escalation"] = escalation
    _state["publisher"] = publisher


@router.get("")
async def list_alerts():
    store: AlertStore = _state["store"]  # type: ignore[assignment]
    alerts = await store.list_active()
    return [a.model_dump() for a in alerts]


@router.post("/{alert_id}/ack")
async def ack_alert(alert_id: str):
    store: AlertStore = _state["store"]  # type: ignore[assignment]
    escalation = _state["escalation"]
    publisher = _state["publisher"]
    a = await store.set_status(alert_id, "acknowledged")
    if a is None:
        raise HTTPException(404, f"alert not found: {alert_id}")
    escalation.cancel(alert_id)
    await publisher.publish_update(a)
    return a.model_dump()


@router.post("/{alert_id}/resolve")
async def resolve_alert(alert_id: str):
    store: AlertStore = _state["store"]  # type: ignore[assignment]
    escalation = _state["escalation"]
    publisher = _state["publisher"]
    a = await store.set_status(alert_id, "resolved")
    if a is None:
        raise HTTPException(404, f"alert not found: {alert_id}")
    escalation.cancel(alert_id)
    await publisher.publish_update(a)
    return a.model_dump()
```

- [ ] **Step 6.4: Smoke import + test suite**

```bash
cd "backend" && source .venv/bin/activate
python3 -c "from app.alerts.publisher import AlertPublisher; from app.api.alerts import router; print('ok')"
python3 -m pytest -v 2>&1 | tail -5
```

Expected: prints `ok`. 37 tests still pass (no new tests in this task).

- [ ] **Step 6.5: Commit**

```bash
git add backend/app/ingest/client.py backend/app/alerts/publisher.py backend/app/api/alerts.py
git commit -m "feat(backend): alerts REST API + MQTT publisher"
```

---

## Task 7: Lifespan wiring + smoke + tag

**Files:**
- Modify: `backend/app/main.py`
- Modify: `docker-compose.yml` — add `DEMO_MODE: "true"` env to backend service (mirroring simulator).
- Modify: `README.md`

- [ ] **Step 7.1: Wire engine + escalation in main.py**

Open `backend/app/main.py`. Replace the entire file content with:

```python
from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .config import Settings
from .logging import configure_logging, get_logger
from .storage.redis import RedisCache
from .storage.influx import InfluxWriter
from .ingest.client import MqttClient
from .ingest import handlers as h
from .api import health as health_api
from .api import residents as residents_api
from .api import alerts as alerts_api
from .alerts.store import AlertStore
from .alerts.engine import AlertEngine
from .alerts.escalation import EscalationManager
from .alerts.publisher import AlertPublisher


settings = Settings.from_env()
configure_logging(settings.log_level)
log = get_logger("backend")

if settings.demo_mode:
    log.warning("DEMO_MODE active — do not run in production")

_cache: RedisCache | None = None
_influx: InfluxWriter | None = None
_mqtt: MqttClient | None = None
_engine: AlertEngine | None = None
_engine_task: asyncio.Task | None = None
_escalation: EscalationManager | None = None


async def _dispatch(family: str, key: str, payload: bytes) -> None:
    assert _cache is not None and _influx is not None
    await h.handle(family, key, payload, _cache, _influx)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cache, _influx, _mqtt, _engine, _engine_task, _escalation
    _cache = await RedisCache.from_url(settings.redis_url)
    _influx = InfluxWriter(
        url=settings.influx_url,
        token=settings.influx_token,
        org=settings.influx_org,
        bucket=settings.influx_bucket,
    )
    _mqtt = MqttClient(settings.mqtt_host, settings.mqtt_port, _dispatch)
    await _mqtt.start()

    store = AlertStore(_cache.client, _influx)
    publisher = AlertPublisher(_mqtt)
    _escalation = EscalationManager(demo_mode=settings.demo_mode)
    _engine = AlertEngine(store=store, publisher=publisher, escalation=_escalation)
    _engine_task = asyncio.create_task(_engine.loop(_cache, interval=1.0))

    health_api.init(_cache, _mqtt.connected, _influx)
    residents_api.init(_cache, _influx)
    alerts_api.init(store, _escalation, publisher)
    log.info("backend_ready",
             redis=settings.redis_url, influx=settings.influx_url, mqtt=settings.mqtt_host,
             demo_mode=settings.demo_mode)
    try:
        yield
    finally:
        if _engine is not None:
            _engine.stop()
        if _engine_task is not None:
            _engine_task.cancel()
            try:
                await _engine_task
            except (asyncio.CancelledError, Exception):
                pass
        if _escalation is not None:
            _escalation.cancel_all()
        if _mqtt is not None:
            await _mqtt.stop()
        if _influx is not None:
            _influx.close()
        if _cache is not None:
            await _cache.close()


app = FastAPI(title="EHPAD Backend", lifespan=lifespan)
app.include_router(health_api.router)
app.include_router(residents_api.router, prefix="/residents")
app.include_router(alerts_api.router, prefix="/alerts")
```

- [ ] **Step 7.2: Add DEMO_MODE to docker-compose backend service**

Open `docker-compose.yml`. In the `backend` service `environment:` block, add a line `DEMO_MODE: "true"` (alongside the existing env vars). Keep all other services unchanged.

After editing, validate:
```bash
docker compose config --quiet
```
Expected: exit 0.

- [ ] **Step 7.3: Smoke import + tests**

```bash
cd "backend" && source .venv/bin/activate
python3 -c "from app.main import app; print('app loaded')"
python3 -m pytest -v 2>&1 | tail -5
```

Expected: prints `app loaded`. 37 tests pass.

- [ ] **Step 7.4: Bring up the stack**

```bash
cd "/Users/drikce/Desktop/projet 2 iot Santé"
docker compose up -d --build
sleep 45
docker compose ps
```

Expected: 5 services healthy.

- [ ] **Step 7.5: Inject a fall scenario, verify alert appears**

```bash
# Fall scenario should produce an Urgence (L4) alert within ~2 s of injection
curl -fsS -X POST http://localhost:9100/scenario/R007 \
  -H 'Content-Type: application/json' -d '{"name":"fall"}'
sleep 5
curl -fsS http://localhost:8000/alerts | python3 -m json.tool
```

Expected: at least one alert object with `resident_id: "R007"` and `level: 4`. Capture the `id` field.

- [ ] **Step 7.6: Verify ack endpoint**

```bash
ALERT_ID=$(curl -fsS http://localhost:8000/alerts | python3 -c "import sys,json; d=json.load(sys.stdin); print([a for a in d if a['resident_id']=='R007'][0]['id'])")
echo "ID=$ALERT_ID"
curl -fsS -X POST "http://localhost:8000/alerts/$ALERT_ID/ack" | python3 -m json.tool
```

Expected: returned alert has `status: "acknowledged"`.

- [ ] **Step 7.7: Verify auto-escalation in DEMO_MODE (optional)**

Reset the resident to `degradation` to produce a sustained ATTENTION:
```bash
curl -fsS -X POST http://localhost:9100/scenario/R008 \
  -H 'Content-Type: application/json' -d '{"name":"degradation"}'
sleep 70  # >60 s in DEMO_MODE → L2 should auto-escalate to L3
curl -fsS http://localhost:8000/alerts | python3 -c "import sys,json; d=json.load(sys.stdin); print([a for a in d if a['resident_id']=='R008'])"
```

Expected: alert level for R008 is ≥ 3 (L3 or higher) — auto-escalated. If DEMO_MODE is off, this won't trigger within the test window.

- [ ] **Step 7.8: Tear down**

```bash
docker compose down
```

- [ ] **Step 7.9: Update README**

Append after the "Backend (sub-project 3 — landed)" section, BEFORE the `See docs/infra-quickstart.md` line:

```markdown

## Alert Engine (sub-project 4 — landed)

5-level alert engine with auto-escalation. Threshold rules over the latest resident state. Sticky alerts (only escalate, never downgrade). DEMO_MODE compresses escalation deadlines (L2→L3 in 60 s instead of 10 min).

```bash
# Inject a fall — produces L4 within ~2 s
curl -fsS -X POST http://localhost:9100/scenario/R007 \
  -H 'Content-Type: application/json' -d '{"name":"fall"}'
sleep 3
curl -fsS http://localhost:8000/alerts | python3 -m json.tool

# Acknowledge an alert
curl -fsS -X POST http://localhost:8000/alerts/<id>/ack

# Resolve an alert
curl -fsS -X POST http://localhost:8000/alerts/<id>/resolve
```

Endpoints:

- `GET /alerts` — list active alerts
- `POST /alerts/{id}/ack` — acknowledge (cancels escalation timer)
- `POST /alerts/{id}/resolve` — resolve (removes from active set)

MQTT topics:

- `ehpad/alerts/new` — new alert payload (QoS 1)
- `ehpad/alerts/update/{id}` — status / level change (QoS 1)
```

- [ ] **Step 7.10: Commit + tag**

```bash
cd "/Users/drikce/Desktop/projet 2 iot Santé"
git add backend/app/main.py docker-compose.yml README.md
git commit -m "feat(backend): wire alert engine + escalation into lifespan; DEMO_MODE in compose"
git tag -a alert-engine-v0.1 -m "Alert engine: 5-level rules, auto-escalation, REST + MQTT publish"
git tag --list
```

Expected: tag `alert-engine-v0.1` listed alongside previous tags.

---

## Done Criteria

- 37 backend pytest tests pass (13 ingest + 7 rules + 8 store + 4 engine + 5 escalation).
- `docker compose up -d --build` brings 5 services healthy.
- Fall scenario injection produces a level-4 alert in `GET /alerts` within ~5 s.
- `POST /alerts/{id}/ack` flips status to `acknowledged` and cancels its escalation timer.
- `DEMO_MODE=true` (default in compose) compresses escalation deadlines.
- Tag `alert-engine-v0.1` exists.

## Self-Review

Spec coverage: §4 alert MQTT topics → publisher.py + QoS 1. §6.1 5-level rules → rules.py. §6.2 auto-escalation deadlines + DEMO_MODE → escalation.py + escalation_delays(). §6.3 ML risk consumed if present (>0.6 → L3) → rules.py. §7 storage layout (alerts:active SET + alerts:detail:<id>) → store.py. REST endpoints (GET /alerts, POST ack, POST resolve) → api/alerts.py.

Type names consistent: AlertLevel, Alert, AlertStore, AlertEngine, EscalationManager, AlertPublisher.

No placeholders. All commands include expected output.
