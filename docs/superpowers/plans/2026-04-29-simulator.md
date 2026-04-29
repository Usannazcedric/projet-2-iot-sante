# Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the EHPAD simulator service: 20 resident profiles, asyncio-based per-resident tick loop, vitals + accelerometer + ambient sensors published over MQTT to Mosquitto, plus a scenario injection REST endpoint to drive demos. Service is dockerized and added to `docker-compose.yml`.

**Architecture:** Single Python process. asyncio task per resident produces vitals (1 Hz) + motion (5 Hz). One asyncio task per room produces PIR + door events. All publish through one shared `paho-mqtt` async client. A small FastAPI app exposes `POST /scenario/{resident_id}` and `GET /residents`. Scenarios are dispatch objects (`normal`, `degradation`, `fall`, `wandering`, `cardiac`) that mutate a `Resident.state` for a duration. `DEMO_MODE=true` compresses scenario timings so demos fit in minutes.

**Tech Stack:** Python 3.12, `asyncio`, `paho-mqtt` (or `aiomqtt`), `fastapi`, `uvicorn`, `pydantic`, `structlog`, `numpy` (gaussian noise + slope), `python-multipart`. Docker (python:3.12-slim base).

---

## Reference

- Design spec: `docs/superpowers/specs/2026-04-29-ehpad-monitoring-design.md` — §4 (MQTT topics), §5 (simulator: profiles, sensor generation, scenario engine, class boundaries), §10 (compose with `simulator` service), §6.2 (DEMO_MODE behavior).
- Build order step 2 of 8.
- Out of scope: backend ingest, alert engine, ML, ws-gateway, frontend. Those are later sub-projects.

## File Structure

```
simulator/
├── Dockerfile
├── pyproject.toml
├── README.md
├── profiles.json                # 20 residents pre-baked
└── app/
    ├── __init__.py
    ├── main.py                  # FastAPI app + asyncio loop bootstrap
    ├── config.py                # env vars (MQTT_HOST, RESIDENT_COUNT, DEMO_MODE)
    ├── logging.py               # structlog JSON setup
    ├── profiles.py              # load + validate profiles.json into Resident objects
    ├── resident.py              # Resident dataclass + tick logic + state
    ├── sensors/
    │   ├── __init__.py
    │   ├── vitals.py            # gaussian + drift + activity modifier
    │   ├── motion.py            # accelerometer generation + activity classification
    │   └── ambient.py           # PIR + door events per room
    ├── scenarios.py             # ScenarioRunner + 5 scenarios
    ├── publisher.py             # SensorPublisher (paho-mqtt async wrapper)
    └── api.py                   # POST /scenario/{resident_id}, GET /residents, GET /health
└── tests/
    ├── __init__.py
    ├── test_resident.py         # tick produces values within baseline ± noise band
    └── test_scenarios.py        # fall scenario triggers correct accel pattern
```

Each file's responsibility:

- `config.py` — env-driven settings; single place to read `MQTT_HOST`, `RESIDENT_COUNT`, `DEMO_MODE`, `MQTT_PORT`, `API_PORT`, `LOG_LEVEL`.
- `logging.py` — structlog JSON config so logs interleave cleanly with backend logs.
- `profiles.py` — pure I/O: parse JSON, return `list[Resident]` or raise on schema error.
- `resident.py` — `Resident` dataclass holding profile + mutable runtime state (current activity, scenario, last vitals). One method `tick(now)` returns sensor readings to publish.
- `sensors/vitals.py` — pure functions: `(profile, state, now) → vitals dict`. No I/O.
- `sensors/motion.py` — pure functions for accelerometer. Activity classification (idle / walking / sitting / lying).
- `sensors/ambient.py` — PIR + door events; takes occupancy map.
- `scenarios.py` — registry mapping name → factory; each scenario implements `apply(resident, now) → None` and `is_done(now) → bool`.
- `publisher.py` — single MQTT connection, batched publish coroutine.
- `api.py` — FastAPI router; thin layer that mutates `ResidentRegistry` (in-memory), no DB.
- `main.py` — wires everything: load profiles, start publisher, schedule asyncio tasks, mount FastAPI.

---

## Pre-Flight

- [ ] **Step 0.1: Confirm working directory + branch**

Run: `pwd && git branch --show-current`

Expected: directory ends with `/projet 2 iot Santé`, branch is `simulator` (or whatever the parent created for this sub-project).

- [ ] **Step 0.2: Confirm Mosquitto reachable**

Run:
```bash
docker compose up -d mosquitto
docker exec ehpad-mosquitto mosquitto_pub -h localhost -t 'ehpad/preflight' -m 'ok'
```

Expected: exit 0 from publish, no error logs.

- [ ] **Step 0.3: Check Python ≥ 3.11 available locally for tests outside container**

Run: `python3 --version`

Expected: `Python 3.11+`. If absent, plan still works (tests run inside the container) but local debug iteration is slower.

---

## Task 1: Simulator package skeleton + profiles

**Files:**
- Create: `simulator/pyproject.toml`
- Create: `simulator/app/__init__.py`
- Create: `simulator/app/config.py`
- Create: `simulator/app/logging.py`
- Create: `simulator/profiles.json`
- Create: `simulator/app/profiles.py`
- Create: `simulator/tests/__init__.py`
- Create: `simulator/README.md`

- [ ] **Step 1.1: Write `simulator/pyproject.toml`**

```toml
[project]
name = "ehpad-simulator"
version = "0.1.0"
description = "EHPAD resident sensor simulator publishing to MQTT."
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",
  "uvicorn[standard]>=0.27",
  "paho-mqtt>=2.0",
  "pydantic>=2.6",
  "structlog>=24.1",
  "numpy>=1.26",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools]
packages = ["app", "app.sensors"]
```

- [ ] **Step 1.2: Write `simulator/app/__init__.py`**

Empty file.

```python
```

- [ ] **Step 1.3: Write `simulator/app/config.py`**

```python
from __future__ import annotations
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    mqtt_host: str
    mqtt_port: int
    api_port: int
    resident_count: int
    demo_mode: bool
    log_level: str
    profiles_path: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            mqtt_host=os.getenv("MQTT_HOST", "mosquitto"),
            mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
            api_port=int(os.getenv("API_PORT", "9100")),
            resident_count=int(os.getenv("RESIDENT_COUNT", "20")),
            demo_mode=os.getenv("DEMO_MODE", "false").lower() == "true",
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            profiles_path=os.getenv("PROFILES_PATH", "/app/profiles.json"),
        )
```

- [ ] **Step 1.4: Write `simulator/app/logging.py`**

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


def get_logger(service: str = "simulator", **bind):
    return structlog.get_logger().bind(service=service, **bind)
```

- [ ] **Step 1.5: Write `simulator/profiles.json` (20 residents)**

```json
[
  {"id": "R001", "name": "Marie D.", "age": 84, "room": "101", "mobility": "autonomous",  "pathologies": ["hypertension"],            "baseline": {"hr": 72, "spo2": 97, "sys": 135, "dia": 80, "temp": 36.8}, "routine": {"wake": "07:00", "sleep": "22:00", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R002", "name": "Jean P.",  "age": 79, "room": "102", "mobility": "autonomous",  "pathologies": [],                          "baseline": {"hr": 68, "spo2": 98, "sys": 128, "dia": 78, "temp": 36.7}, "routine": {"wake": "06:30", "sleep": "21:30", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R003", "name": "Suzanne L.","age": 88, "room": "103", "mobility": "assisted",   "pathologies": ["alzheimer"],               "baseline": {"hr": 76, "spo2": 96, "sys": 140, "dia": 82, "temp": 36.6}, "routine": {"wake": "07:30", "sleep": "21:00", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R004", "name": "Pierre M.", "age": 81, "room": "104", "mobility": "wheelchair", "pathologies": ["diabetes"],                "baseline": {"hr": 74, "spo2": 96, "sys": 138, "dia": 84, "temp": 36.7}, "routine": {"wake": "07:00", "sleep": "22:00", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R005", "name": "Yvette R.", "age": 91, "room": "105", "mobility": "bedridden",  "pathologies": ["heart_failure"],           "baseline": {"hr": 80, "spo2": 94, "sys": 130, "dia": 78, "temp": 36.5}, "routine": {"wake": "08:00", "sleep": "20:30", "meals": ["08:30","12:30","19:00"]}},
  {"id": "R006", "name": "Michel B.", "age": 77, "room": "106", "mobility": "autonomous", "pathologies": [],                          "baseline": {"hr": 70, "spo2": 98, "sys": 125, "dia": 78, "temp": 36.8}, "routine": {"wake": "06:30", "sleep": "22:30", "meals": ["08:00","12:30","19:30"]}},
  {"id": "R007", "name": "Anne T.",   "age": 85, "room": "107", "mobility": "assisted",   "pathologies": ["hypertension","diabetes"], "baseline": {"hr": 78, "spo2": 95, "sys": 145, "dia": 88, "temp": 36.7}, "routine": {"wake": "07:00", "sleep": "21:30", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R008", "name": "Henri S.",  "age": 83, "room": "108", "mobility": "autonomous", "pathologies": ["copd"],                    "baseline": {"hr": 74, "spo2": 92, "sys": 132, "dia": 80, "temp": 36.7}, "routine": {"wake": "07:00", "sleep": "22:00", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R009", "name": "Lucienne G.","age": 87, "room": "109", "mobility": "wheelchair","pathologies": ["alzheimer","hypertension"],"baseline": {"hr": 76, "spo2": 96, "sys": 138, "dia": 82, "temp": 36.6}, "routine": {"wake": "07:30", "sleep": "21:00", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R010", "name": "Robert F.", "age": 80, "room": "110", "mobility": "autonomous", "pathologies": [],                          "baseline": {"hr": 72, "spo2": 97, "sys": 130, "dia": 80, "temp": 36.8}, "routine": {"wake": "07:00", "sleep": "22:00", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R011", "name": "Denise K.", "age": 86, "room": "111", "mobility": "assisted",   "pathologies": ["arthritis"],               "baseline": {"hr": 74, "spo2": 96, "sys": 134, "dia": 80, "temp": 36.7}, "routine": {"wake": "07:00", "sleep": "21:30", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R012", "name": "Georges V.","age": 82, "room": "112", "mobility": "autonomous", "pathologies": ["parkinson"],               "baseline": {"hr": 70, "spo2": 97, "sys": 128, "dia": 78, "temp": 36.7}, "routine": {"wake": "06:45", "sleep": "22:00", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R013", "name": "Paulette H.","age":89, "room": "113", "mobility": "bedridden",  "pathologies": ["dementia"],                "baseline": {"hr": 78, "spo2": 95, "sys": 135, "dia": 82, "temp": 36.6}, "routine": {"wake": "08:00", "sleep": "20:30", "meals": ["08:30","12:30","19:00"]}},
  {"id": "R014", "name": "Bernard A.","age": 78, "room": "114", "mobility": "autonomous", "pathologies": ["diabetes"],                "baseline": {"hr": 72, "spo2": 97, "sys": 132, "dia": 80, "temp": 36.7}, "routine": {"wake": "07:00", "sleep": "22:00", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R015", "name": "Christiane O.","age":85,"room": "115", "mobility": "assisted",  "pathologies": ["osteoporosis"],            "baseline": {"hr": 74, "spo2": 96, "sys": 130, "dia": 78, "temp": 36.7}, "routine": {"wake": "07:30", "sleep": "21:30", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R016", "name": "Andre N.",  "age": 84, "room": "116", "mobility": "autonomous", "pathologies": ["hypertension"],            "baseline": {"hr": 76, "spo2": 97, "sys": 138, "dia": 84, "temp": 36.8}, "routine": {"wake": "06:30", "sleep": "22:00", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R017", "name": "Madeleine C.","age":90,"room": "117", "mobility": "wheelchair", "pathologies": ["heart_failure","diabetes"],"baseline": {"hr": 82, "spo2": 93, "sys": 140, "dia": 84, "temp": 36.5}, "routine": {"wake": "08:00", "sleep": "20:30", "meals": ["08:30","12:30","19:00"]}},
  {"id": "R018", "name": "Roger W.",  "age": 76, "room": "118", "mobility": "autonomous", "pathologies": [],                          "baseline": {"hr": 70, "spo2": 98, "sys": 125, "dia": 78, "temp": 36.7}, "routine": {"wake": "07:00", "sleep": "22:30", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R019", "name": "Simone E.", "age": 88, "room": "119", "mobility": "assisted",   "pathologies": ["alzheimer"],               "baseline": {"hr": 76, "spo2": 95, "sys": 134, "dia": 80, "temp": 36.6}, "routine": {"wake": "07:30", "sleep": "21:00", "meals": ["08:00","12:30","19:00"]}},
  {"id": "R020", "name": "Claude J.", "age": 81, "room": "120", "mobility": "autonomous", "pathologies": ["hypertension"],            "baseline": {"hr": 74, "spo2": 97, "sys": 136, "dia": 82, "temp": 36.8}, "routine": {"wake": "07:00", "sleep": "22:00", "meals": ["08:00","12:30","19:00"]}}
]
```

- [ ] **Step 1.6: Write `simulator/app/profiles.py`**

```python
from __future__ import annotations
import json
from pathlib import Path
from pydantic import BaseModel, Field


class Baseline(BaseModel):
    hr: int
    spo2: int
    sys: int
    dia: int
    temp: float


class Routine(BaseModel):
    wake: str
    sleep: str
    meals: list[str]


class Profile(BaseModel):
    id: str = Field(pattern=r"^R\d{3}$")
    name: str
    age: int = Field(ge=0, le=120)
    room: str
    mobility: str
    pathologies: list[str]
    baseline: Baseline
    routine: Routine


def load_profiles(path: str | Path) -> list[Profile]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return [Profile.model_validate(p) for p in raw]
```

- [ ] **Step 1.7: Create empty test package**

File: `simulator/tests/__init__.py`

```python
```

- [ ] **Step 1.8: Write `simulator/README.md`**

```markdown
# EHPAD Simulator

Publishes synthetic resident sensor data over MQTT for the EHPAD monitoring stack.

## Topics

- `ehpad/vitals/resident/<id>` — vitals at 1 Hz
- `ehpad/motion/resident/<id>` — accelerometer + activity at 5 Hz
- `ehpad/ambient/room/<room>` — PIR motion events
- `ehpad/door/room/<room>` — door open/close events

## REST endpoints

- `GET /health` — 200 once MQTT connected
- `GET /residents` — list of profiles
- `POST /scenario/{resident_id}` — body `{ "name": "fall|cardiac|degradation|wandering|normal" }`

## Configuration

Env vars (with defaults):

| Variable        | Default    |
| --------------- | ---------- |
| MQTT_HOST       | mosquitto  |
| MQTT_PORT       | 1883       |
| API_PORT        | 9100       |
| RESIDENT_COUNT  | 20         |
| DEMO_MODE       | false      |
| LOG_LEVEL       | INFO       |

`DEMO_MODE=true` compresses scenario timings (`degradation` 30 min → ~3 min).
```

- [ ] **Step 1.9: Verify package import works**

Run from the simulator directory:
```bash
cd simulator && python3 -c "from app.profiles import load_profiles; print(len(load_profiles('profiles.json')))"
```

Expected: prints `20`. If pydantic isn't installed locally, skip this step — verification will run inside the container in Task 6.

- [ ] **Step 1.10: Commit**

```bash
git add simulator/
git commit -m "feat(simulator): package skeleton, profiles, config, logging"
```

---

## Task 2: Resident state and tick logic

**Files:**
- Create: `simulator/app/resident.py`
- Create: `simulator/tests/test_resident.py`

- [ ] **Step 2.1: Write the failing test first (TDD)**

File: `simulator/tests/test_resident.py`

```python
from __future__ import annotations
from datetime import datetime, timezone
from app.profiles import Profile, Baseline, Routine
from app.resident import Resident


def make_profile() -> Profile:
    return Profile(
        id="R999",
        name="Test",
        age=80,
        room="999",
        mobility="autonomous",
        pathologies=[],
        baseline=Baseline(hr=70, spo2=98, sys=130, dia=80, temp=36.8),
        routine=Routine(wake="07:00", sleep="22:00", meals=["08:00", "12:30", "19:00"]),
    )


def test_tick_returns_vitals_within_baseline_band():
    r = Resident.from_profile(make_profile(), seed=42)
    now = datetime(2026, 4, 29, 10, 0, 0, tzinfo=timezone.utc)
    reading = r.tick(now)
    v = reading["vitals"]
    assert 60 <= v["hr"] <= 90
    assert 90 <= v["spo2"] <= 100
    assert 35.5 <= v["temp"] <= 38.0
    assert v["sys"] >= v["dia"]


def test_tick_seq_is_monotonic():
    r = Resident.from_profile(make_profile(), seed=42)
    now = datetime(2026, 4, 29, 10, 0, 0, tzinfo=timezone.utc)
    seqs = [r.tick(now)["seq"] for _ in range(5)]
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == 5
```

- [ ] **Step 2.2: Run the test to confirm it fails**

```bash
cd simulator && python3 -m pytest tests/test_resident.py -v
```

Expected: import error or `Resident` not found — test fails.

- [ ] **Step 2.3: Write minimal `simulator/app/resident.py` to pass**

```python
from __future__ import annotations
import itertools
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
import numpy as np
from .profiles import Profile


@dataclass
class Resident:
    profile: Profile
    rng: np.random.Generator
    seq: itertools.count = field(default_factory=lambda: itertools.count(1))
    activity: str = "idle"
    scenario: str = "normal"

    @classmethod
    def from_profile(cls, profile: Profile, seed: int | None = None) -> "Resident":
        rng = np.random.default_rng(seed)
        return cls(profile=profile, rng=rng)

    def tick(self, now: datetime) -> dict[str, Any]:
        b = self.profile.baseline
        hr = int(b.hr + self.rng.normal(0, 3))
        spo2 = int(np.clip(b.spo2 + self.rng.normal(0, 1), 90, 100))
        sys = int(b.sys + self.rng.normal(0, 4))
        dia = int(b.dia + self.rng.normal(0, 3))
        if dia > sys - 20:
            dia = sys - 20
        temp = float(round(b.temp + self.rng.normal(0, 0.1), 2))
        return {
            "timestamp": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "resident_id": self.profile.id,
            "values": {"hr": hr, "spo2": spo2, "sys": sys, "dia": dia, "temp": temp},
            "vitals": {"hr": hr, "spo2": spo2, "sys": sys, "dia": dia, "temp": temp},
            "seq": next(self.seq),
        }
```

- [ ] **Step 2.4: Run the test to confirm it passes**

```bash
cd simulator && python3 -m pytest tests/test_resident.py -v
```

Expected: 2 passed.

- [ ] **Step 2.5: Commit**

```bash
git add simulator/app/resident.py simulator/tests/test_resident.py
git commit -m "feat(simulator): Resident dataclass with tick generating vitals"
```

---

## Task 3: Sensor modules — vitals, motion, ambient

**Files:**
- Create: `simulator/app/sensors/__init__.py`
- Create: `simulator/app/sensors/vitals.py`
- Create: `simulator/app/sensors/motion.py`
- Create: `simulator/app/sensors/ambient.py`

The vitals logic currently lives inline in `Resident.tick`. Extract it into `sensors/vitals.py` so it's testable in isolation and can be reused. Motion and ambient are new.

- [ ] **Step 3.1: Create empty `simulator/app/sensors/__init__.py`**

```python
```

- [ ] **Step 3.2: Write `simulator/app/sensors/vitals.py`**

```python
from __future__ import annotations
from typing import TypedDict
import numpy as np
from ..profiles import Profile


class Vitals(TypedDict):
    hr: int
    spo2: int
    sys: int
    dia: int
    temp: float


def generate(profile: Profile, activity: str, rng: np.random.Generator) -> Vitals:
    b = profile.baseline
    activity_hr_offset = {"idle": 0, "sitting": 0, "walking": 8, "lying": -3}.get(activity, 0)
    hr = int(b.hr + activity_hr_offset + rng.normal(0, 3))
    spo2 = int(np.clip(b.spo2 + rng.normal(0, 1), 90, 100))
    sys = int(b.sys + rng.normal(0, 4))
    dia = int(b.dia + rng.normal(0, 3))
    if dia > sys - 20:
        dia = sys - 20
    temp = float(round(b.temp + rng.normal(0, 0.1), 2))
    return Vitals(hr=hr, spo2=spo2, sys=sys, dia=dia, temp=temp)
```

- [ ] **Step 3.3: Write `simulator/app/sensors/motion.py`**

```python
from __future__ import annotations
from typing import TypedDict
import numpy as np


class Accel(TypedDict):
    ax: float
    ay: float
    az: float
    activity: str


def generate(activity: str, rng: np.random.Generator) -> Accel:
    if activity == "walking":
        ax = float(rng.normal(0.0, 0.4))
        ay = float(rng.normal(0.0, 0.4))
        az = float(rng.normal(9.81, 0.6))
    elif activity == "sitting":
        ax = float(rng.normal(0.0, 0.05))
        ay = float(rng.normal(0.0, 0.05))
        az = float(rng.normal(9.81, 0.05))
    elif activity == "lying":
        ax = float(rng.normal(0.0, 0.05))
        ay = float(rng.normal(9.81, 0.1))
        az = float(rng.normal(0.0, 0.05))
    else:
        ax = float(rng.normal(0.0, 0.02))
        ay = float(rng.normal(0.0, 0.02))
        az = float(rng.normal(9.81, 0.02))
    return Accel(ax=round(ax, 3), ay=round(ay, 3), az=round(az, 3), activity=activity)


def fall_pattern(rng: np.random.Generator) -> Accel:
    spike = float(rng.uniform(20.0, 35.0))
    ax = float(rng.normal(0.0, 1.5))
    return Accel(ax=round(ax, 3), ay=round(spike, 3), az=round(0.0, 3), activity="falling")
```

- [ ] **Step 3.4: Write `simulator/app/sensors/ambient.py`**

```python
from __future__ import annotations
from typing import TypedDict
import numpy as np


class PIR(TypedDict):
    type: str
    value: int


class DoorEvent(TypedDict):
    type: str
    value: int


def pir(motion: bool, rng: np.random.Generator) -> PIR:
    return PIR(type="pir", value=1 if motion else 0)


def door(opened: bool) -> DoorEvent:
    return DoorEvent(type="door", value=1 if opened else 0)
```

- [ ] **Step 3.5: Refactor `Resident.tick` to use `sensors.vitals.generate`**

Replace the inline body of `tick` in `simulator/app/resident.py` with a call to `vitals.generate`. New `resident.py`:

```python
from __future__ import annotations
import itertools
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
import numpy as np
from .profiles import Profile
from .sensors import vitals as vitals_mod
from .sensors import motion as motion_mod


@dataclass
class Resident:
    profile: Profile
    rng: np.random.Generator
    seq_vitals: itertools.count = field(default_factory=lambda: itertools.count(1))
    seq_motion: itertools.count = field(default_factory=lambda: itertools.count(1))
    activity: str = "idle"
    scenario: str = "normal"

    @classmethod
    def from_profile(cls, profile: Profile, seed: int | None = None) -> "Resident":
        rng = np.random.default_rng(seed)
        return cls(profile=profile, rng=rng)

    def tick(self, now: datetime) -> dict[str, Any]:
        v = vitals_mod.generate(self.profile, self.activity, self.rng)
        ts = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return {
            "timestamp": ts,
            "resident_id": self.profile.id,
            "values": dict(v),
            "vitals": dict(v),
            "seq": next(self.seq_vitals),
        }

    def tick_motion(self, now: datetime) -> dict[str, Any]:
        a = motion_mod.generate(self.activity, self.rng)
        ts = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return {
            "timestamp": ts,
            "resident_id": self.profile.id,
            "values": dict(a),
            "seq": next(self.seq_motion),
        }
```

- [ ] **Step 3.6: Re-run resident tests**

```bash
cd simulator && python3 -m pytest tests/test_resident.py -v
```

Expected: 2 passed (refactor preserved behavior).

- [ ] **Step 3.7: Commit**

```bash
git add simulator/app/sensors/ simulator/app/resident.py
git commit -m "feat(simulator): vitals/motion/ambient sensor modules; refactor Resident.tick"
```

---

## Task 4: Scenarios + scenario tests

**Files:**
- Create: `simulator/app/scenarios.py`
- Create: `simulator/tests/test_scenarios.py`

- [ ] **Step 4.1: Write failing test first**

File: `simulator/tests/test_scenarios.py`

```python
from __future__ import annotations
from datetime import datetime, timezone
from app.profiles import Profile, Baseline, Routine
from app.resident import Resident
from app.scenarios import build, register


def _profile(rid: str = "R900") -> Profile:
    return Profile(
        id=rid, name="X", age=80, room="900", mobility="autonomous", pathologies=[],
        baseline=Baseline(hr=70, spo2=98, sys=130, dia=80, temp=36.8),
        routine=Routine(wake="07:00", sleep="22:00", meals=["08:00","12:30","19:00"]),
    )


def test_fall_scenario_marks_activity_falling_then_lying():
    r = Resident.from_profile(_profile(), seed=1)
    s = build("fall", demo_mode=True)
    now = datetime(2026, 4, 29, 10, 0, 0, tzinfo=timezone.utc)
    s.apply(r, now)
    assert r.activity in {"falling", "lying"}


def test_cardiac_scenario_raises_hr_drops_spo2():
    r = Resident.from_profile(_profile(), seed=1)
    s = build("cardiac", demo_mode=True)
    now = datetime(2026, 4, 29, 10, 0, 0, tzinfo=timezone.utc)
    s.apply(r, now)
    assert r.scenario == "cardiac"


def test_normal_scenario_is_a_noop():
    r = Resident.from_profile(_profile(), seed=1)
    s = build("normal", demo_mode=True)
    now = datetime(2026, 4, 29, 10, 0, 0, tzinfo=timezone.utc)
    s.apply(r, now)
    assert r.scenario == "normal"


def test_unknown_scenario_raises():
    try:
        build("nonsense", demo_mode=True)
    except KeyError:
        return
    raise AssertionError("expected KeyError for unknown scenario")
```

- [ ] **Step 4.2: Run failing test**

```bash
cd simulator && python3 -m pytest tests/test_scenarios.py -v
```

Expected: import error / `build` not found.

- [ ] **Step 4.3: Write `simulator/app/scenarios.py`**

```python
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable, Protocol
from .resident import Resident


class Scenario(Protocol):
    def apply(self, resident: Resident, now: datetime) -> None: ...
    def is_done(self, now: datetime) -> bool: ...


_REGISTRY: dict[str, Callable[[bool], Scenario]] = {}


def register(name: str):
    def deco(factory: Callable[[bool], Scenario]):
        _REGISTRY[name] = factory
        return factory
    return deco


def build(name: str, demo_mode: bool) -> Scenario:
    if name not in _REGISTRY:
        raise KeyError(f"unknown scenario: {name}")
    return _REGISTRY[name](demo_mode)


@dataclass
class Normal:
    deadline: datetime | None = None
    def apply(self, r: Resident, now: datetime) -> None:
        r.scenario = "normal"
    def is_done(self, now: datetime) -> bool:
        return True


@dataclass
class Fall:
    started: datetime | None = None
    duration: timedelta = timedelta(minutes=5)
    def apply(self, r: Resident, now: datetime) -> None:
        if self.started is None:
            self.started = now
            r.activity = "falling"
            r.scenario = "fall"
        elif (now - self.started).total_seconds() > 1.0:
            r.activity = "lying"
    def is_done(self, now: datetime) -> bool:
        return self.started is not None and (now - self.started) >= self.duration


@dataclass
class Cardiac:
    started: datetime | None = None
    duration: timedelta = timedelta(minutes=5)
    def apply(self, r: Resident, now: datetime) -> None:
        r.scenario = "cardiac"
        # Cardiac modifies vitals via the sensor pipeline reading r.scenario.
        # Vitals module checks scenario in a follow-up step.
    def is_done(self, now: datetime) -> bool:
        return self.started is not None and (now - self.started) >= self.duration


@dataclass
class Wandering:
    started: datetime | None = None
    duration: timedelta = timedelta(minutes=10)
    def apply(self, r: Resident, now: datetime) -> None:
        r.scenario = "wandering"
        r.activity = "walking"
    def is_done(self, now: datetime) -> bool:
        return self.started is not None and (now - self.started) >= self.duration


@dataclass
class Degradation:
    started: datetime | None = None
    duration: timedelta = timedelta(minutes=30)  # compressed in demo
    def apply(self, r: Resident, now: datetime) -> None:
        if self.started is None:
            self.started = now
        r.scenario = "degradation"
    def is_done(self, now: datetime) -> bool:
        return self.started is not None and (now - self.started) >= self.duration


@register("normal")
def _normal(demo: bool) -> Scenario:
    return Normal()


@register("fall")
def _fall(demo: bool) -> Scenario:
    return Fall(duration=timedelta(seconds=30) if demo else timedelta(minutes=5))


@register("cardiac")
def _cardiac(demo: bool) -> Scenario:
    return Cardiac(duration=timedelta(seconds=30) if demo else timedelta(minutes=5))


@register("wandering")
def _wandering(demo: bool) -> Scenario:
    return Wandering(duration=timedelta(minutes=1) if demo else timedelta(minutes=10))


@register("degradation")
def _degradation(demo: bool) -> Scenario:
    return Degradation(duration=timedelta(minutes=3) if demo else timedelta(minutes=30))
```

- [ ] **Step 4.4: Update `vitals.generate` to honor `cardiac` and `degradation` via Resident state**

Replace `simulator/app/sensors/vitals.py` with:

```python
from __future__ import annotations
from typing import TypedDict
import numpy as np
from ..profiles import Profile


class Vitals(TypedDict):
    hr: int
    spo2: int
    sys: int
    dia: int
    temp: float


def generate(
    profile: Profile,
    activity: str,
    rng: np.random.Generator,
    *,
    scenario: str = "normal",
    severity: float = 0.0,
) -> Vitals:
    b = profile.baseline
    activity_hr_offset = {"idle": 0, "sitting": 0, "walking": 8, "lying": -3}.get(activity, 0)
    hr_drift = 0.0
    spo2_drift = 0.0
    if scenario == "cardiac":
        hr_drift = 60.0 * severity
        spo2_drift = -8.0 * severity
    elif scenario == "degradation":
        hr_drift = 12.0 * severity
        spo2_drift = -5.0 * severity
    hr = int(b.hr + activity_hr_offset + hr_drift + rng.normal(0, 3))
    spo2 = int(np.clip(b.spo2 + spo2_drift + rng.normal(0, 1), 70, 100))
    sys = int(b.sys + rng.normal(0, 4))
    dia = int(b.dia + rng.normal(0, 3))
    if dia > sys - 20:
        dia = sys - 20
    temp = float(round(b.temp + rng.normal(0, 0.1), 2))
    return Vitals(hr=hr, spo2=spo2, sys=sys, dia=dia, temp=temp)
```

- [ ] **Step 4.5: Update `Resident.tick` to pass `scenario` and a placeholder `severity=1.0` once active**

Replace `tick` body in `simulator/app/resident.py` (keep rest of file the same):

```python
    def tick(self, now: datetime) -> dict[str, Any]:
        severity = 1.0 if self.scenario in {"cardiac", "degradation"} else 0.0
        v = vitals_mod.generate(self.profile, self.activity, self.rng,
                                scenario=self.scenario, severity=severity)
        ts = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return {
            "timestamp": ts,
            "resident_id": self.profile.id,
            "values": dict(v),
            "vitals": dict(v),
            "seq": next(self.seq_vitals),
        }
```

- [ ] **Step 4.6: Run scenario tests + resident tests**

```bash
cd simulator && python3 -m pytest -v
```

Expected: all tests pass (2 in test_resident, 4 in test_scenarios).

- [ ] **Step 4.7: Commit**

```bash
git add simulator/app/scenarios.py simulator/app/sensors/vitals.py simulator/app/resident.py simulator/tests/test_scenarios.py
git commit -m "feat(simulator): scenarios with DEMO_MODE compression; vitals respects scenario"
```

---

## Task 5: MQTT publisher and main loop wiring

**Files:**
- Create: `simulator/app/publisher.py`
- Create: `simulator/app/api.py`
- Create: `simulator/app/main.py`

- [ ] **Step 5.1: Write `simulator/app/publisher.py`**

```python
from __future__ import annotations
import asyncio
import json
import paho.mqtt.client as mqtt
from typing import Any


class Publisher:
    def __init__(self, host: str, port: int, client_id: str = "ehpad-simulator") -> None:
        self.client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                                  client_id=client_id)
        self.host = host
        self.port = port
        self.connected = asyncio.Event()
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            asyncio.get_event_loop().call_soon_threadsafe(self.connected.set)

    def _on_disconnect(self, client, userdata, *args, **kwargs):
        asyncio.get_event_loop().call_soon_threadsafe(self.connected.clear)

    async def start(self) -> None:
        self.client.connect_async(self.host, self.port, keepalive=30)
        self.client.loop_start()
        await asyncio.wait_for(self.connected.wait(), timeout=15)

    async def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()

    def publish(self, topic: str, payload: dict[str, Any], qos: int = 0) -> None:
        self.client.publish(topic, json.dumps(payload), qos=qos)
```

- [ ] **Step 5.2: Write `simulator/app/api.py`**

```python
from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from .resident import Resident
from .scenarios import build


router = APIRouter()
_residents: dict[str, Resident] = {}
_demo_mode: bool = False


def init(residents: dict[str, Resident], demo_mode: bool) -> None:
    global _residents, _demo_mode
    _residents = residents
    _demo_mode = demo_mode


class ScenarioBody(BaseModel):
    name: str


@router.get("/health")
def health():
    return {"status": "ok", "residents": len(_residents)}


@router.get("/residents")
def list_residents():
    return [r.profile.model_dump() for r in _residents.values()]


@router.post("/scenario/{resident_id}")
def inject_scenario(resident_id: str, body: ScenarioBody):
    if resident_id not in _residents:
        raise HTTPException(404, f"unknown resident {resident_id}")
    try:
        scenario = build(body.name, demo_mode=_demo_mode)
    except KeyError:
        raise HTTPException(400, f"unknown scenario {body.name}")
    r = _residents[resident_id]
    from datetime import datetime, timezone
    scenario.apply(r, datetime.now(timezone.utc))
    r._active_scenario = scenario  # type: ignore[attr-defined]
    return {"resident_id": resident_id, "scenario": body.name}
```

- [ ] **Step 5.3: Write `simulator/app/main.py`**

```python
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from fastapi import FastAPI
from .config import Settings
from .logging import configure_logging, get_logger
from .profiles import load_profiles
from .resident import Resident
from .publisher import Publisher
from . import api


settings = Settings.from_env()
configure_logging(settings.log_level)
log = get_logger("simulator")

app = FastAPI(title="EHPAD Simulator")
app.include_router(api.router)

_publisher: Publisher | None = None
_residents: dict[str, Resident] = {}
_tasks: list[asyncio.Task] = []


async def vitals_loop(resident: Resident) -> None:
    while True:
        now = datetime.now(timezone.utc)
        sc = getattr(resident, "_active_scenario", None)
        if sc is not None:
            try:
                sc.apply(resident, now)
                if sc.is_done(now):
                    resident._active_scenario = None  # type: ignore[attr-defined]
                    resident.scenario = "normal"
            except Exception as exc:
                log.error("scenario_apply_failed", resident_id=resident.profile.id, err=str(exc))
        reading = resident.tick(now)
        if _publisher is not None:
            _publisher.publish(f"ehpad/vitals/resident/{resident.profile.id}", reading, qos=0)
        await asyncio.sleep(1.0)


async def motion_loop(resident: Resident) -> None:
    while True:
        now = datetime.now(timezone.utc)
        reading = resident.tick_motion(now)
        if _publisher is not None:
            _publisher.publish(f"ehpad/motion/resident/{resident.profile.id}", reading, qos=0)
        await asyncio.sleep(0.2)


@app.on_event("startup")
async def on_startup() -> None:
    global _publisher
    profiles = load_profiles(settings.profiles_path)[: settings.resident_count]
    for p in profiles:
        _residents[p.id] = Resident.from_profile(p, seed=hash(p.id) & 0xFFFFFFFF)
    api.init(_residents, settings.demo_mode)
    _publisher = Publisher(settings.mqtt_host, settings.mqtt_port)
    await _publisher.start()
    log.info("publisher_connected", host=settings.mqtt_host, port=settings.mqtt_port)
    for r in _residents.values():
        _tasks.append(asyncio.create_task(vitals_loop(r)))
        _tasks.append(asyncio.create_task(motion_loop(r)))
    log.info("simulator_ready", residents=len(_residents), demo_mode=settings.demo_mode)


@app.on_event("shutdown")
async def on_shutdown() -> None:
    for t in _tasks:
        t.cancel()
    if _publisher is not None:
        await _publisher.stop()
```

- [ ] **Step 5.4: Run tests**

```bash
cd simulator && python3 -m pytest -v
```

Expected: all 6 tests still passing (publisher/api/main not under test directly).

- [ ] **Step 5.5: Commit**

```bash
git add simulator/app/publisher.py simulator/app/api.py simulator/app/main.py
git commit -m "feat(simulator): MQTT publisher, FastAPI scenario API, asyncio per-resident loops"
```

---

## Task 6: Dockerfile + add to compose

**Files:**
- Create: `simulator/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 6.1: Write `simulator/Dockerfile`**

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
COPY profiles.json /app/profiles.json

EXPOSE 9100

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=10s \
  CMD curl -fsS http://localhost:9100/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9100"]
```

- [ ] **Step 6.2: Modify `docker-compose.yml` to add the simulator service**

The current compose has 3 services (mosquitto, redis, influxdb) and 3 volumes. Add a new `simulator` service AFTER `influxdb`. The full updated `docker-compose.yml` should be:

```yaml
services:
  mosquitto:
    image: eclipse-mosquitto:2
    container_name: ehpad-mosquitto
    ports:
      - "1883:1883"
    volumes:
      - ./mosquitto/config:/mosquitto/config:ro
      - mosquitto-data:/mosquitto/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "mosquitto_sub -h localhost -t '$$SYS/#' -C 1 -E -i healthcheck -W 3"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 5s

  redis:
    image: redis:7-alpine
    container_name: ehpad-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 3s

  influxdb:
    image: influxdb:2.7
    container_name: ehpad-influxdb
    ports:
      - "8086:8086"
    environment:
      DOCKER_INFLUXDB_INIT_MODE: setup
      DOCKER_INFLUXDB_INIT_USERNAME: ${INFLUX_USERNAME:-admin}
      DOCKER_INFLUXDB_INIT_PASSWORD: ${INFLUX_PASSWORD:-ehpad-admin}
      DOCKER_INFLUXDB_INIT_ORG: ${INFLUX_ORG:-ehpad}
      DOCKER_INFLUXDB_INIT_BUCKET: ${INFLUX_BUCKET:-ehpad_vitals}
      DOCKER_INFLUXDB_INIT_RETENTION: 720h
      DOCKER_INFLUXDB_INIT_ADMIN_TOKEN: ${INFLUX_ADMIN_TOKEN:-ehpad-token-dev}
    volumes:
      - influx-data:/var/lib/influxdb2
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "influx", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  simulator:
    build: ./simulator
    container_name: ehpad-simulator
    ports:
      - "9100:9100"
    depends_on:
      mosquitto:
        condition: service_healthy
    environment:
      MQTT_HOST: mosquitto
      MQTT_PORT: 1883
      API_PORT: 9100
      RESIDENT_COUNT: 20
      DEMO_MODE: "true"
      LOG_LEVEL: INFO
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:9100/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 15s

volumes:
  mosquitto-data:
  redis-data:
  influx-data:
```

- [ ] **Step 6.3: Build and bring up**

```bash
docker compose up -d --build simulator
docker compose ps
```

Expected: `ehpad-simulator` reaches `healthy` within ~30 s after build.

- [ ] **Step 6.4: Verify the API works**

```bash
curl -fsS http://localhost:9100/health
curl -fsS http://localhost:9100/residents | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d), d[0]['id'])"
```

Expected: `{"status":"ok","residents":20}`, then `20 R001`.

- [ ] **Step 6.5: Verify MQTT publishes are arriving**

```bash
docker exec ehpad-mosquitto mosquitto_sub -h localhost -t 'ehpad/vitals/resident/R001' -C 1 -W 5
```

Expected: prints one JSON payload with `resident_id: R001`, vitals fields, monotonic seq. Exits 0.

```bash
docker exec ehpad-mosquitto mosquitto_sub -h localhost -t 'ehpad/motion/resident/R001' -C 1 -W 5
```

Expected: prints one motion payload with `ax/ay/az/activity`.

- [ ] **Step 6.6: Inject the fall scenario on R012 and observe**

```bash
curl -fsS -X POST http://localhost:9100/scenario/R012 \
  -H 'Content-Type: application/json' \
  -d '{"name":"fall"}'
docker exec ehpad-mosquitto mosquitto_sub -h localhost -t 'ehpad/motion/resident/R012' -C 5 -W 5
```

Expected: 5 motion payloads. Earliest one shows activity `falling` or `lying`.

- [ ] **Step 6.7: Tear down to leave a clean state**

```bash
docker compose down
```

Expected: containers stop cleanly.

- [ ] **Step 6.8: Commit**

```bash
git add simulator/Dockerfile docker-compose.yml
git commit -m "feat(simulator): Dockerfile and compose service publishing 20 residents"
```

---

## Task 7: Documentation update + tag

**Files:**
- Modify: `README.md` (add a "Simulator" section after the existing quickstart)

- [ ] **Step 7.1: Append a simulator section to `README.md`**

Open `README.md` and add the following AFTER the existing "Stop everything" block and BEFORE the "See `docs/infra-quickstart.md`" line:

```markdown

## Simulator (sub-project 2 — landed)

The simulator publishes synthetic vitals + motion + ambient data for 20 residents at 1 Hz / 5 Hz over MQTT.

```bash
docker compose up -d --build
curl -fsS http://localhost:9100/health
curl -fsS http://localhost:9100/residents | python3 -m json.tool | head -40
```

Inject a scenario (fall, cardiac, degradation, wandering, normal):

```bash
curl -fsS -X POST http://localhost:9100/scenario/R007 \
  -H 'Content-Type: application/json' -d '{"name":"degradation"}'
```

Watch the live MQTT stream for any resident:

```bash
docker exec ehpad-mosquitto mosquitto_sub -h localhost -t 'ehpad/vitals/resident/+' -v
```

`DEMO_MODE=true` (default in compose) compresses scenario timings.
```

- [ ] **Step 7.2: Verify the README**

```bash
grep -A 2 "Simulator (sub-project 2" README.md
```

Expected: shows the new section header and the first description line.

- [ ] **Step 7.3: Commit**

```bash
git add README.md
git commit -m "docs(simulator): document scenarios, endpoints, and MQTT topics"
```

- [ ] **Step 7.4: Tag**

```bash
git tag -a simulator-v0.1 -m "Simulator: 20 residents publishing vitals + motion + scenarios"
git tag --list
```

Expected: tag `simulator-v0.1` listed alongside `infra-v0.1`.

---

## Done Criteria

- `docker compose up -d --build` brings all 4 services healthy.
- `GET /residents` returns 20 entries.
- `mosquitto_sub` shows live publishes on `ehpad/vitals/resident/+` and `ehpad/motion/resident/+`.
- `POST /scenario/R012 {"name":"fall"}` causes the resident's motion stream to switch to `falling`/`lying`.
- All 6 pytest tests pass inside the container (`docker exec ehpad-simulator python3 -m pytest`).
- Tag `simulator-v0.1` exists.

## Self-Review

Spec coverage: §5 simulator (profiles, sensors, scenarios, class boundaries) → Tasks 1–4. §4 MQTT topics → Task 5 (publisher) and Task 6 (smoke). §6.2 DEMO_MODE → Task 4 (scenario factories) and Task 6 (env). §10 compose addition → Task 6.

Out of scope (left for later sub-projects): backend ingest, alert engine, ML, ws-gateway, frontend, ambient PIR scheduler (PIR module exists but is not yet wired into a per-room loop — that lands when the backend needs ambient occupancy or a separate sub-project covers room state).

No placeholders, no TBDs. All commands include expected output. Type names consistent (Profile/Baseline/Routine/Resident/Scenario/Vitals/Accel/Settings).
