# Backend Ingest + Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the EHPAD backend service that subscribes to MQTT sensor topics, caches latest state in Redis, persists time-series in InfluxDB, and exposes a read-only REST API consumed by later sub-projects (alert engine, frontend). No alerting logic, no ML, no WebSocket — those are subsequent sub-projects.

**Architecture:** Single Python process. One asyncio task subscribes to Mosquitto via paho-mqtt and dispatches messages by topic prefix. Message handlers write last-state JSON to Redis (TTL 60 s) and append to a batched InfluxDB write queue (flushed every 1 s). FastAPI exposes `GET /health`, `GET /residents`, `GET /residents/{id}`, `GET /residents/{id}/history`. Each module isolated: `ingest`, `storage/redis`, `storage/influx`, `api/residents`. structlog for JSON logs.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, paho-mqtt 2.x, redis-py (asyncio), influxdb-client (sync, run in threadpool), pydantic 2.x, structlog, numpy (for slope helpers shared with later ML sub-project — minimal use here). Docker (python:3.12-slim).

---

## Reference

- Design spec: `docs/superpowers/specs/2026-04-29-ehpad-monitoring-design.md` — §4 (MQTT topics + payload format), §6 (backend modules), §7 (storage layout: Redis keys + Influx measurements + retention), §10 (compose backend service + healthcheck), §11.5 (structured logging).
- Build order: step 3 of 8.
- Out of scope for this plan: alert engine + escalation (sub-project 4), ws-gateway (5), frontend (6), ML (7), final docs polish (8). Stub no logic for those — REST endpoints they will need (e.g. `/alerts`, `/risk`) are NOT created here.

## File Structure

```
backend/
├── Dockerfile
├── pyproject.toml
├── README.md
└── app/
    ├── __init__.py
    ├── main.py             # FastAPI app, lifespan, MQTT client, /health
    ├── config.py           # Settings.from_env()
    ├── logging.py          # structlog JSON setup (same as simulator)
    ├── models.py           # pydantic schemas: VitalsPayload, MotionPayload, ResidentSnapshot
    ├── ingest/
    │   ├── __init__.py
    │   ├── client.py       # paho-mqtt async wrapper, connect + subscribe + dispatch
    │   ├── handlers.py     # one function per topic family (vitals, motion, ambient)
    │   └── topics.py       # topic constants + matchers
    ├── storage/
    │   ├── __init__.py
    │   ├── redis.py        # state:resident:<id>, room state, atomic SETEX
    │   └── influx.py       # batched writer, query helpers
    └── api/
        ├── __init__.py
        ├── residents.py    # GET / + GET /{id} + GET /{id}/history
        └── health.py       # GET /health
└── tests/
    ├── __init__.py
    ├── test_redis_cache.py # state:resident roundtrip via fakeredis
    └── test_handlers.py    # ingest dispatch routes payload to right storage
```

Each file's responsibility:

- `config.py` — env-driven settings: `MQTT_HOST`, `MQTT_PORT`, `REDIS_URL`, `INFLUX_URL`, `INFLUX_TOKEN`, `INFLUX_ORG`, `INFLUX_BUCKET`, `API_PORT`, `LOG_LEVEL`.
- `models.py` — pydantic models matching the simulator's payload format (timestamp, resident_id, values{}, seq).
- `ingest/topics.py` — constants for topic prefixes + helper to extract `resident_id`/`room_id` from a topic.
- `ingest/client.py` — wraps paho-mqtt (VERSION2 callback), subscribes on connect, parses JSON, dispatches to handlers.
- `ingest/handlers.py` — pure functions taking `(payload, redis, influx_writer)` — one per topic family. No threading concerns inside the handlers.
- `storage/redis.py` — `set_resident_state`, `get_resident_state`, `list_residents`. Uses redis-py asyncio.
- `storage/influx.py` — `Writer` class wrapping influxdb_client.WriteApi in a background-flush coroutine. Provides `write_vitals`, `write_motion`, `query_history`.
- `api/residents.py` — REST endpoints reading from Redis (live) and Influx (history).
- `api/health.py` — readiness check (Redis ping + Influx ping + MQTT connected).
- `main.py` — lifespan: connect Redis, connect Influx, start ingest, mount routers.

---

## Pre-Flight

- [ ] **Step 0.1: Confirm working directory + branch**

Run: `pwd && git branch --show-current`

Expected: dir ends with `/projet 2 iot Santé`. Branch is `backend-ingest`.

- [ ] **Step 0.2: Confirm previous services healthy**

```bash
docker compose up -d
sleep 30
for s in mosquitto redis influxdb simulator; do
  echo "$s: $(docker inspect --format '{{.State.Health.Status}}' ehpad-$s)"
done
```

Expected: 4 services `healthy`. The simulator must be running so the new backend has data to ingest.

- [ ] **Step 0.3: Confirm Python ≥ 3.11 + pip available locally for tests**

Run: `python3 --version`

Expected: `Python 3.11+`. If absent, tests run inside the container in Task 6.

---

## Task 1: Backend package skeleton

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/README.md`
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Create: `backend/app/logging.py`
- Create: `backend/app/models.py`
- Create: `backend/tests/__init__.py`

- [ ] **Step 1.1: Write `backend/pyproject.toml`**

```toml
[project]
name = "ehpad-backend"
version = "0.1.0"
description = "EHPAD backend: MQTT ingest, Redis state cache, InfluxDB history, REST API."
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",
  "uvicorn[standard]>=0.27",
  "paho-mqtt>=2.0",
  "redis>=5.0",
  "influxdb-client>=1.40",
  "pydantic>=2.6",
  "structlog>=24.1",
  "numpy>=1.26",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "fakeredis>=2.21"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools]
packages = ["app", "app.ingest", "app.storage", "app.api"]
```

- [ ] **Step 1.2: Write `backend/README.md`**

```markdown
# EHPAD Backend (Sub-project 3)

MQTT ingest + Redis state cache + InfluxDB history + read-only REST API.

## REST endpoints

- `GET /health` — 200 once Redis + Influx + MQTT connected
- `GET /residents` — list of last-state snapshots
- `GET /residents/{id}` — single resident snapshot
- `GET /residents/{id}/history?from=&to=&metric=` — Influx Flux query

## Configuration

| Variable        | Default               |
| --------------- | --------------------- |
| MQTT_HOST       | mosquitto             |
| MQTT_PORT       | 1883                  |
| REDIS_URL       | redis://redis:6379    |
| INFLUX_URL      | http://influxdb:8086  |
| INFLUX_TOKEN    | ehpad-token-dev       |
| INFLUX_ORG      | ehpad                 |
| INFLUX_BUCKET   | ehpad_vitals          |
| API_PORT        | 8000                  |
| LOG_LEVEL       | INFO                  |
```

- [ ] **Step 1.3: Write `backend/app/__init__.py`**

```python
```

- [ ] **Step 1.4: Write `backend/app/config.py`**

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
        )
```

- [ ] **Step 1.5: Write `backend/app/logging.py`**

```python
from __future__ import annotations
import logging
import structlog


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, level.upper(), logging.INFO),
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(service: str = "backend", **bind):
    return structlog.get_logger().bind(service=service, **bind)
```

- [ ] **Step 1.6: Write `backend/app/models.py`**

```python
from __future__ import annotations
from typing import Any
from pydantic import BaseModel, Field


class VitalsValues(BaseModel):
    hr: int
    spo2: int
    sys: int
    dia: int
    temp: float


class MotionValues(BaseModel):
    ax: float
    ay: float
    az: float
    activity: str


class VitalsPayload(BaseModel):
    timestamp: str
    resident_id: str = Field(pattern=r"^R\d{3}$")
    values: VitalsValues
    seq: int


class MotionPayload(BaseModel):
    timestamp: str
    resident_id: str = Field(pattern=r"^R\d{3}$")
    values: MotionValues
    seq: int


class AmbientPayload(BaseModel):
    timestamp: str
    room_id: str | None = None
    resident_id: str | None = None
    values: dict[str, Any]
    seq: int = 0


class ResidentSnapshot(BaseModel):
    resident_id: str
    last_seen: str | None = None
    vitals: VitalsValues | None = None
    motion: MotionValues | None = None
    scenario: str | None = None
```

- [ ] **Step 1.7: Write `backend/tests/__init__.py`**

```python
```

- [ ] **Step 1.8: Verify package layout**

Run: `ls -1 backend backend/app backend/tests`

Expected: shows `pyproject.toml`, `README.md`, `app/`, `tests/`, then inside `app/` shows `__init__.py`, `config.py`, `logging.py`, `models.py`.

- [ ] **Step 1.9: Commit**

```bash
git add backend/
git commit -m "feat(backend): package skeleton, config, logging, payload models"
```

---

## Task 2: Topic + ingest dispatch (TDD)

**Files:**
- Create: `backend/app/ingest/__init__.py`
- Create: `backend/app/ingest/topics.py`
- Create: `backend/tests/test_topics.py`

Topics module is pure parsing logic — easy to test without infra.

- [ ] **Step 2.1: Write the failing tests first**

File: `backend/tests/test_topics.py`

```python
from __future__ import annotations
from app.ingest import topics


def test_parse_vitals_topic_extracts_resident_id():
    fam, key = topics.parse("ehpad/vitals/resident/R007")
    assert fam == "vitals"
    assert key == "R007"


def test_parse_motion_topic_extracts_resident_id():
    fam, key = topics.parse("ehpad/motion/resident/R012")
    assert fam == "motion"
    assert key == "R012"


def test_parse_ambient_topic_extracts_room_id():
    fam, key = topics.parse("ehpad/ambient/room/101")
    assert fam == "ambient"
    assert key == "101"


def test_parse_door_topic_extracts_room_id():
    fam, key = topics.parse("ehpad/door/room/101")
    assert fam == "door"
    assert key == "101"


def test_parse_unknown_topic_returns_other():
    fam, key = topics.parse("ehpad/garbage/foo/bar")
    assert fam == "other"
    assert key is None
```

- [ ] **Step 2.2: Run failing test**

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -e .[dev] >/dev/null 2>&1 && python3 -m pytest tests/test_topics.py -v
```

Expected: ImportError or attribute error (topics module not yet defined).

- [ ] **Step 2.3: Write minimal implementation**

File: `backend/app/ingest/__init__.py`

```python
```

File: `backend/app/ingest/topics.py`

```python
from __future__ import annotations
from typing import Tuple


VITALS_PREFIX = "ehpad/vitals/resident/"
MOTION_PREFIX = "ehpad/motion/resident/"
AMBIENT_PREFIX = "ehpad/ambient/room/"
DOOR_PREFIX = "ehpad/door/room/"

SUBSCRIBE_PATTERNS: list[str] = [
    "ehpad/vitals/resident/+",
    "ehpad/motion/resident/+",
    "ehpad/ambient/room/+",
    "ehpad/door/room/+",
]


def parse(topic: str) -> Tuple[str, str | None]:
    """Return (family, identifier) for a known topic, or ("other", None)."""
    for prefix, fam in (
        (VITALS_PREFIX, "vitals"),
        (MOTION_PREFIX, "motion"),
        (AMBIENT_PREFIX, "ambient"),
        (DOOR_PREFIX, "door"),
    ):
        if topic.startswith(prefix):
            return fam, topic[len(prefix):]
    return "other", None
```

- [ ] **Step 2.4: Re-run tests**

```bash
cd backend && source .venv/bin/activate && python3 -m pytest tests/test_topics.py -v
```

Expected: 5 passed.

- [ ] **Step 2.5: Commit**

```bash
git add backend/app/ingest/__init__.py backend/app/ingest/topics.py backend/tests/test_topics.py
git commit -m "feat(backend): MQTT topic parser with TDD"
```

---

## Task 3: Redis storage (TDD with fakeredis)

**Files:**
- Create: `backend/app/storage/__init__.py`
- Create: `backend/app/storage/redis.py`
- Create: `backend/tests/test_redis_cache.py`

- [ ] **Step 3.1: Write the failing test first**

File: `backend/tests/test_redis_cache.py`

```python
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
```

- [ ] **Step 3.2: Run failing test**

```bash
cd backend && source .venv/bin/activate && python3 -m pytest tests/test_redis_cache.py -v
```

Expected: ImportError on `RedisCache`.

- [ ] **Step 3.3: Write minimal implementation**

File: `backend/app/storage/__init__.py`

```python
```

File: `backend/app/storage/redis.py`

```python
from __future__ import annotations
import json
from typing import Any
import redis.asyncio as aioredis


STATE_TTL_SECONDS = 60
RESIDENT_KEY = "state:resident:{id}"
RESIDENT_PATTERN = "state:resident:*"


class RedisCache:
    def __init__(self, client: aioredis.Redis) -> None:
        self.client = client

    @classmethod
    async def from_url(cls, url: str) -> "RedisCache":
        client = aioredis.from_url(url, decode_responses=True)
        await client.ping()
        return cls(client=client)

    async def set_resident_state(self, resident_id: str, state: dict[str, Any]) -> None:
        await self.client.set(
            RESIDENT_KEY.format(id=resident_id),
            json.dumps(state),
            ex=STATE_TTL_SECONDS,
        )

    async def get_resident_state(self, resident_id: str) -> dict[str, Any] | None:
        raw = await self.client.get(RESIDENT_KEY.format(id=resident_id))
        if raw is None:
            return None
        return json.loads(raw)

    async def list_residents(self) -> list[str]:
        ids: list[str] = []
        async for key in self.client.scan_iter(match=RESIDENT_PATTERN, count=100):
            ids.append(key.split(":", 2)[-1])
        return ids

    async def merge_resident_state(self, resident_id: str, partial: dict[str, Any]) -> dict[str, Any]:
        current = await self.get_resident_state(resident_id) or {}
        current.update(partial)
        await self.set_resident_state(resident_id, current)
        return current

    async def close(self) -> None:
        await self.client.aclose()
```

- [ ] **Step 3.4: Re-run tests**

```bash
cd backend && source .venv/bin/activate && python3 -m pytest tests/test_redis_cache.py -v
```

Expected: 4 passed.

- [ ] **Step 3.5: Commit**

```bash
git add backend/app/storage/__init__.py backend/app/storage/redis.py backend/tests/test_redis_cache.py
git commit -m "feat(backend): RedisCache for resident state with TTL (TDD)"
```

---

## Task 4: Influx writer + handlers (TDD with stub writer)

**Files:**
- Create: `backend/app/storage/influx.py`
- Create: `backend/app/ingest/handlers.py`
- Create: `backend/tests/test_handlers.py`

- [ ] **Step 4.1: Write Influx writer (no test — exercised via handlers)**

File: `backend/app/storage/influx.py`

```python
from __future__ import annotations
import asyncio
from typing import Any
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import ASYNCHRONOUS


class InfluxWriter:
    def __init__(self, url: str, token: str, org: str, bucket: str) -> None:
        self._client = InfluxDBClient(url=url, token=token, org=org)
        self._write = self._client.write_api(write_options=ASYNCHRONOUS)
        self.bucket = bucket
        self.org = org

    def ping(self) -> bool:
        return self._client.ping()

    def close(self) -> None:
        self._write.close()
        self._client.close()

    async def write_vitals(self, resident_id: str, ts: str, values: dict[str, Any]) -> None:
        p = (
            Point("vitals")
            .tag("resident_id", resident_id)
            .field("hr", int(values["hr"]))
            .field("spo2", int(values["spo2"]))
            .field("sys", int(values["sys"]))
            .field("dia", int(values["dia"]))
            .field("temp", float(values["temp"]))
            .time(ts)
        )
        await asyncio.to_thread(self._write.write, bucket=self.bucket, org=self.org, record=p)

    async def write_motion(self, resident_id: str, ts: str, values: dict[str, Any]) -> None:
        p = (
            Point("motion")
            .tag("resident_id", resident_id)
            .tag("activity", str(values.get("activity", "unknown")))
            .field("ax", float(values["ax"]))
            .field("ay", float(values["ay"]))
            .field("az", float(values["az"]))
            .time(ts)
        )
        await asyncio.to_thread(self._write.write, bucket=self.bucket, org=self.org, record=p)

    async def query_history(self, resident_id: str, metric: str, from_iso: str, to_iso: str) -> list[dict[str, Any]]:
        qa = self._client.query_api()
        flux = (
            f'from(bucket:"{self.bucket}") '
            f'|> range(start: {from_iso}, stop: {to_iso}) '
            f'|> filter(fn: (r) => r._measurement == "{metric}") '
            f'|> filter(fn: (r) => r["resident_id"] == "{resident_id}") '
        )
        tables = await asyncio.to_thread(qa.query, flux, org=self.org)
        rows: list[dict[str, Any]] = []
        for table in tables:
            for record in table.records:
                rows.append({
                    "time": record.get_time().isoformat() if record.get_time() else None,
                    "field": record.get_field(),
                    "value": record.get_value(),
                    "resident_id": record.values.get("resident_id"),
                })
        return rows
```

- [ ] **Step 4.2: Write the failing handler tests**

File: `backend/tests/test_handlers.py`

```python
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
```

- [ ] **Step 4.3: Run failing test**

```bash
cd backend && source .venv/bin/activate && python3 -m pytest tests/test_handlers.py -v
```

Expected: ImportError or undefined.

- [ ] **Step 4.4: Write the handlers**

File: `backend/app/ingest/handlers.py`

```python
from __future__ import annotations
import json
from typing import Any
from ..models import VitalsPayload, MotionPayload
from ..storage.redis import RedisCache
from ..logging import get_logger

log = get_logger("backend.ingest")


async def handle(family: str, key: str, raw: str | bytes, cache: RedisCache, influx: Any) -> None:
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        log.warning("invalid_json", family=family, key=key)
        return
    try:
        if family == "vitals":
            await _handle_vitals(data, cache, influx)
        elif family == "motion":
            await _handle_motion(data, cache, influx)
        # ambient/door deliberately ignored at this stage
    except Exception as exc:  # noqa: BLE001 -- log and recover; ingest must never crash
        log.error("handler_failed", family=family, key=key, err=str(exc))


async def _handle_vitals(data: dict[str, Any], cache: RedisCache, influx: Any) -> None:
    payload = VitalsPayload.model_validate(data)
    await cache.merge_resident_state(payload.resident_id, {
        "last_seen": payload.timestamp,
        "vitals": payload.values.model_dump(),
    })
    await influx.write_vitals(payload.resident_id, payload.timestamp, payload.values.model_dump())


async def _handle_motion(data: dict[str, Any], cache: RedisCache, influx: Any) -> None:
    payload = MotionPayload.model_validate(data)
    await cache.merge_resident_state(payload.resident_id, {
        "last_seen": payload.timestamp,
        "motion": payload.values.model_dump(),
    })
    await influx.write_motion(payload.resident_id, payload.timestamp, payload.values.model_dump())
```

- [ ] **Step 4.5: Re-run tests**

```bash
cd backend && source .venv/bin/activate && python3 -m pytest -v
```

Expected: all tests pass (5 topics + 4 redis + 4 handlers = 13 total).

- [ ] **Step 4.6: Commit**

```bash
git add backend/app/storage/influx.py backend/app/ingest/handlers.py backend/tests/test_handlers.py
git commit -m "feat(backend): InfluxDB writer + ingest handlers for vitals/motion (TDD)"
```

---

## Task 5: MQTT client wiring + REST API + main

**Files:**
- Create: `backend/app/ingest/client.py`
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/health.py`
- Create: `backend/app/api/residents.py`
- Create: `backend/app/main.py`

- [ ] **Step 5.1: Write the MQTT client**

File: `backend/app/ingest/client.py`

```python
from __future__ import annotations
import asyncio
from typing import Awaitable, Callable
import paho.mqtt.client as mqtt
from .topics import SUBSCRIBE_PATTERNS, parse


Dispatch = Callable[[str, str, bytes], Awaitable[None]]


class MqttClient:
    def __init__(self, host: str, port: int, dispatch: Dispatch, client_id: str = "ehpad-backend") -> None:
        self.host = host
        self.port = port
        self.dispatch = dispatch
        self.client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                                  client_id=client_id)
        self.connected = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            for p in SUBSCRIBE_PATTERNS:
                client.subscribe(p, qos=0)
            if self._loop is not None:
                self._loop.call_soon_threadsafe(self.connected.set)

    def _on_disconnect(self, client, userdata, *args, **kwargs):
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self.connected.clear)

    def _on_message(self, client, userdata, msg):
        if self._loop is None:
            return
        family, key = parse(msg.topic)
        if key is None:
            return
        asyncio.run_coroutine_threadsafe(
            self.dispatch(family, key, msg.payload),
            self._loop,
        )

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self.client.connect_async(self.host, self.port, keepalive=30)
        self.client.loop_start()
        await asyncio.wait_for(self.connected.wait(), timeout=15)

    async def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()
```

- [ ] **Step 5.2: Write the API routers**

File: `backend/app/api/__init__.py`

```python
```

File: `backend/app/api/health.py`

```python
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from ..storage.redis import RedisCache


router = APIRouter()
_state: dict[str, object] = {}


def init(cache: RedisCache, mqtt_event, influx) -> None:
    _state["cache"] = cache
    _state["mqtt_event"] = mqtt_event
    _state["influx"] = influx


@router.get("/health")
async def health():
    cache: RedisCache = _state["cache"]  # type: ignore[assignment]
    mqtt_event = _state["mqtt_event"]
    influx = _state["influx"]
    try:
        await cache.client.ping()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"redis: {exc}")
    if not mqtt_event.is_set():
        raise HTTPException(503, "mqtt: not connected")
    try:
        ok = influx.ping()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"influx: {exc}")
    if not ok:
        raise HTTPException(503, "influx: ping=false")
    return {"status": "ok"}
```

File: `backend/app/api/residents.py`

```python
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timedelta, timezone
from ..storage.redis import RedisCache


router = APIRouter()
_state: dict[str, object] = {}


def init(cache: RedisCache, influx) -> None:
    _state["cache"] = cache
    _state["influx"] = influx


@router.get("")
async def list_residents():
    cache: RedisCache = _state["cache"]  # type: ignore[assignment]
    ids = await cache.list_residents()
    out = []
    for rid in sorted(ids):
        s = await cache.get_resident_state(rid)
        if s:
            out.append({"resident_id": rid, **s})
    return out


@router.get("/{resident_id}")
async def get_resident(resident_id: str):
    cache: RedisCache = _state["cache"]  # type: ignore[assignment]
    state = await cache.get_resident_state(resident_id)
    if state is None:
        raise HTTPException(404, f"resident not found: {resident_id}")
    return {"resident_id": resident_id, **state}


@router.get("/{resident_id}/history")
async def get_history(
    resident_id: str,
    metric: str = Query("vitals"),
    minutes: int = Query(15, ge=1, le=1440),
):
    influx = _state["influx"]
    now = datetime.now(timezone.utc)
    from_iso = (now - timedelta(minutes=minutes)).isoformat()
    to_iso = now.isoformat()
    rows = await influx.query_history(resident_id, metric, from_iso, to_iso)
    return {"resident_id": resident_id, "metric": metric, "rows": rows}
```

- [ ] **Step 5.3: Write `backend/app/main.py`**

File: `backend/app/main.py`

```python
from __future__ import annotations
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


settings = Settings.from_env()
configure_logging(settings.log_level)
log = get_logger("backend")

_cache: RedisCache | None = None
_influx: InfluxWriter | None = None
_mqtt: MqttClient | None = None


async def _dispatch(family: str, key: str, payload: bytes) -> None:
    assert _cache is not None and _influx is not None
    await h.handle(family, key, payload, _cache, _influx)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cache, _influx, _mqtt
    _cache = await RedisCache.from_url(settings.redis_url)
    _influx = InfluxWriter(
        url=settings.influx_url,
        token=settings.influx_token,
        org=settings.influx_org,
        bucket=settings.influx_bucket,
    )
    _mqtt = MqttClient(settings.mqtt_host, settings.mqtt_port, _dispatch)
    await _mqtt.start()
    health_api.init(_cache, _mqtt.connected, _influx)
    residents_api.init(_cache, _influx)
    log.info("backend_ready", redis=settings.redis_url, influx=settings.influx_url, mqtt=settings.mqtt_host)
    try:
        yield
    finally:
        if _mqtt is not None:
            await _mqtt.stop()
        if _influx is not None:
            _influx.close()
        if _cache is not None:
            await _cache.close()


app = FastAPI(title="EHPAD Backend", lifespan=lifespan)
app.include_router(health_api.router)
app.include_router(residents_api.router, prefix="/residents")
```

- [ ] **Step 5.4: Run tests (no regression)**

```bash
cd backend && source .venv/bin/activate && python3 -m pytest -v
```

Expected: 13 pass.

Smoke import check:

```bash
cd backend && source .venv/bin/activate && python3 -c "from app.main import app; print('app loaded')"
```

Expected: prints `app loaded`.

- [ ] **Step 5.5: Commit**

```bash
git add backend/app/ingest/client.py backend/app/api/__init__.py backend/app/api/health.py backend/app/api/residents.py backend/app/main.py
git commit -m "feat(backend): MQTT client wiring + REST API (residents + health) + lifespan"
```

---

## Task 6: Dockerfile + compose integration

**Files:**
- Create: `backend/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 6.1: Write `backend/Dockerfile`**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /app/pyproject.toml
RUN pip install --upgrade pip && pip install .

COPY app /app/app

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=15s \
  CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 6.2: Modify `docker-compose.yml`**

Add a `backend` service AFTER the `simulator` service. The full compose now has 5 services: mosquitto, redis, influxdb, simulator, backend. Insert this block (preserving existing services) and keep `volumes:` at the bottom:

```yaml
  backend:
    build: ./backend
    container_name: ehpad-backend
    ports:
      - "8000:8000"
    depends_on:
      mosquitto: { condition: service_healthy }
      redis:     { condition: service_healthy }
      influxdb:  { condition: service_healthy }
    environment:
      MQTT_HOST: mosquitto
      MQTT_PORT: 1883
      REDIS_URL: redis://redis:6379
      INFLUX_URL: http://influxdb:8086
      INFLUX_TOKEN: ehpad-token-dev
      INFLUX_ORG: ehpad
      INFLUX_BUCKET: ehpad_vitals
      LOG_LEVEL: INFO
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s
```

The full updated `docker-compose.yml` MUST also retain the simulator block from sub-project 2 (already present). After editing, run `docker compose config --quiet` to verify YAML is valid.

- [ ] **Step 6.3: Build + bring up**

```bash
docker compose up -d --build backend
sleep 30
docker compose ps
```

Expected: `ehpad-backend` reaches `healthy` within ~45 s. The simulator is already running and feeding data.

- [ ] **Step 6.4: Verify REST API**

```bash
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8000/residents | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d), d[0]['resident_id'])"
curl -fsS http://localhost:8000/residents/R001 | python3 -m json.tool
```

Expected:
- `/health` → `{"status":"ok"}`.
- `/residents` → length 20, first id `R001` (or any of R001..R020).
- `/residents/R001` → JSON with `last_seen`, `vitals` block; if motion arrived first, `motion` block too.

- [ ] **Step 6.5: Verify InfluxDB ingest**

```bash
docker exec ehpad-influxdb influx query \
  --token ehpad-token-dev --org ehpad \
  'from(bucket:"ehpad_vitals") |> range(start: -2m) |> filter(fn:(r)=>r._measurement=="vitals") |> filter(fn:(r)=>r["resident_id"]=="R001") |> count()'
```

Expected: count > 0 across the 5 vital fields. If 0, check `docker compose logs backend` for ingest errors.

- [ ] **Step 6.6: Verify history endpoint**

```bash
curl -fsS "http://localhost:8000/residents/R001/history?metric=vitals&minutes=2" | python3 -m json.tool | head -30
```

Expected: `rows` array non-empty with `field` ∈ {hr, spo2, sys, dia, temp} and `resident_id=R001`.

- [ ] **Step 6.7: Tear down**

```bash
docker compose down
```

- [ ] **Step 6.8: Commit**

```bash
git add backend/Dockerfile docker-compose.yml
git commit -m "feat(backend): Dockerfile + compose service wired to mosquitto/redis/influxdb"
```

---

## Task 7: Documentation update + tag

**Files:**
- Modify: `README.md` — add a "Backend (sub-project 3 — landed)" section AFTER the "Simulator (sub-project 2 — landed)" section.

- [ ] **Step 7.1: Append the new section**

Insert this AFTER the existing simulator section block and BEFORE the "See `docs/infra-quickstart.md`" line:

```markdown

## Backend (sub-project 3 — landed)

Subscribes to MQTT sensor topics, caches latest state in Redis, persists history in InfluxDB, exposes a read-only REST API.

```bash
docker compose up -d --build backend
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8000/residents | python3 -m json.tool | head -40
curl -fsS "http://localhost:8000/residents/R001/history?metric=vitals&minutes=5" | python3 -m json.tool | head -20
```

Endpoints:

- `GET /health` — 200 once Redis + Influx + MQTT connected.
- `GET /residents` — list of last-state snapshots.
- `GET /residents/{id}` — single resident snapshot.
- `GET /residents/{id}/history?metric=vitals&minutes=15` — Influx-backed time-series.
```

- [ ] **Step 7.2: Verify**

```bash
grep -A 1 "Backend (sub-project 3" README.md
```

Expected: shows the header.

- [ ] **Step 7.3: Commit**

```bash
git add README.md
git commit -m "docs(backend): document REST endpoints and quickstart"
```

- [ ] **Step 7.4: Tag**

```bash
git tag -a backend-ingest-v0.1 -m "Backend ingest+storage: MQTT subscriber, Redis state, InfluxDB history, REST API"
git tag --list
```

Expected: `backend-ingest-v0.1` listed alongside `infra-v0.1`, `simulator-v0.1`.

---

## Done Criteria

- `docker compose up -d --build` brings 5 services healthy (mosquitto, redis, influxdb, simulator, backend).
- `GET /residents` returns 20 entries within ~10 s of bring-up (after simulator publishes its first messages and backend ingests them).
- `GET /residents/R001/history?metric=vitals&minutes=2` returns non-empty rows from InfluxDB.
- All 13 pytest tests pass.
- Tag `backend-ingest-v0.1` exists.

## Self-Review

Spec coverage: §4 MQTT topics → topics.py + ingest dispatch. §6 backend modules (ingest, storage/redis, storage/influx, api/residents, api/health, models, config, logging) → all created (alerts/* and ml/* deliberately deferred to later sub-projects). §7 storage layout (state:resident:<id> + ehpad_vitals/motion) → redis.py + influx.py. §10 compose backend healthcheck → Task 6. §11.5 structlog JSON logs → logging.py.

No placeholders. All commands include expected output. Type names consistent across modules (RedisCache, InfluxWriter, MqttClient, Settings).
