# EHPAD Health Monitoring — Design Spec

**Date:** 2026-04-29
**Project:** Projet 2 IoT/Santé — Détection de malaise en EHPAD
**Scope:** MUST (M1–M7) + S1 (ML prediction) + S4 (auto-escalation)

## 1. Goal

Build a working EHPAD monitoring system that simulates 20 residents, ingests their sensor data over MQTT, detects and predicts health issues with a 5-level alert system, and exposes a real-time dashboard. The whole stack launches with `docker compose up`.

## 2. Stack

| Layer            | Choice                                       |
| ---------------- | -------------------------------------------- |
| MQTT broker      | Eclipse Mosquitto 2                          |
| Simulator        | Python (asyncio + paho-mqtt)                 |
| Backend          | Python (FastAPI)                             |
| ML               | scikit-learn (IsolationForest + trend rules) |
| WebSocket bridge | Node.js (mqtt + ws)                          |
| Cache            | Redis 7                                      |
| Time-series DB   | InfluxDB 2.7                                 |
| Front-end        | React + Vite + TypeScript + Tailwind + shadcn/ui |
| Orchestration    | Docker Compose                               |

## 3. Architecture

```
simulator ──MQTT──▶ mosquitto ──▶ backend (subscribe)
                         │              │
                         │              ├─▶ redis (last state)
                         │              ├─▶ influxdb (history)
                         │              └─▶ alert engine + ML
                         │                      │
                         │              alerts ─┘
                         │              ▲
                         │              │ MQTT publish
                         │              │
                         ▼              │
                    ws-gateway ◀────────┘
                         │
                         ▼ WebSocket
                    frontend (React)
```

**Boundaries:**

- Simulator only publishes — no API.
- Backend is the single source of truth for state and alerts. Front never talks MQTT directly.
- ws-gateway is dumb — never writes, only subscribes MQTT and pushes to clients via WebSocket.
- Front consumes REST (history, lists) + WebSocket (live updates).

**Why a separate Node WebSocket bridge:** decouples real-time fan-out from heavy ingest/ML in the backend, and Node handles many concurrent WebSocket clients cheaply.

## 4. MQTT Topic Structure

Naming convention: `ehpad/<domain>/<scope>/<id>`

**Sensor topics (simulator → backend):**

```
ehpad/vitals/resident/<id>          # FC, SpO2, PA, T° per resident, 1 Hz
ehpad/motion/resident/<id>          # accelerometer, fall detection, 5 Hz
ehpad/ambient/room/<room_id>        # PIR motion sensor per room
ehpad/door/room/<room_id>           # door open/close events
```

**Alert / state topics (backend → ws-gateway → front):**

```
ehpad/alerts/new                    # new alert event
ehpad/alerts/update/<alert_id>      # status change (acked, escalated, resolved)
ehpad/state/resident/<id>           # aggregated state snapshot after ingest
ehpad/risk/resident/<id>            # ML risk score updates
```

**Acknowledgement** goes through REST (`POST /alerts/:id/ack`), not MQTT, to keep the audit trail clean.

**QoS:**

| Topic                  | QoS |
| ---------------------- | --- |
| vitals / motion / ambient / state | 0   |
| alerts/*               | 1   |

**Payload format** is JSON with `timestamp`, `resident_id` or `room_id`, `values{}`, and a monotonic `seq` counter for drop detection.

```json
{
  "timestamp": "2026-04-29T14:22:01.123Z",
  "resident_id": "R007",
  "values": {"hr": 78, "spo2": 97, "sys": 128, "dia": 82, "temp": 36.7},
  "seq": 4521
}
```

## 5. Simulator (M1, M2)

**Resident profile** (20 generated at startup, JSON in `simulator/profiles.json`):

```json
{
  "id": "R001",
  "name": "Marie D.",
  "age": 84,
  "room": "101",
  "mobility": "autonomous|assisted|wheelchair|bedridden",
  "pathologies": ["hypertension", "diabetes", "alzheimer"],
  "baseline": {"hr": 72, "spo2": 97, "sys": 135, "dia": 80, "temp": 36.8},
  "routine": {"wake": "07:00", "sleep": "22:00", "meals": ["08:00","12:30","19:00"]}
}
```

**Sensor generation:**

- Vitals at 1 Hz: gaussian noise around baseline + circadian drift + activity modifier.
- Accelerometer at 5 Hz: idle / walking / sitting / lying patterns; rare fall = sudden Z-axis spike + posture change to lying.
- Ambient PIR per room: motion when resident active in that room.
- Door: open events tied to movement transitions.

**Scenario engine** (`simulator/scenarios.py`):

| Scenario      | Effect                                                   |
| ------------- | -------------------------------------------------------- |
| `normal`      | Default baseline behavior                                |
| `degradation` | Slow vitals drift over 30–60 min (for ML demo)           |
| `fall`        | Sudden accelerometer spike + no motion afterwards        |
| `wandering`   | Resident moves unusually at night                        |
| `cardiac`     | Sudden HR spike + SpO2 drop                              |

Scenarios injected via REST endpoint on the simulator (`POST /scenario/:resident_id`) for live demos.

**Internals:** asyncio task per resident, single shared MQTT client. Single Python process handles 20 residents (~120 msg/s combined).

**Class boundaries:** `Resident` (state + tick), `SensorPublisher` (MQTT IO), `ScenarioRunner` (injects events). Each kept under ~200 LOC.

## 6. Backend (M3, M5, S1, S4)

**Module layout:**

```
backend/
├── Dockerfile
├── pyproject.toml
├── app/
│   ├── main.py              # FastAPI app, startup/shutdown, MQTT client, /health
│   ├── ingest.py            # MQTT subscriber → redis + influx
│   ├── logging.py           # structlog setup (JSON, contextual fields)
│   ├── config.py            # env vars: DEMO_MODE, MQTT_HOST, etc.
│   ├── alerts/
│   │   ├── rules.py         # threshold rules per level
│   │   ├── engine.py        # eval rules, emit alerts
│   │   └── escalation.py    # timer-based level upgrade
│   ├── ml/
│   │   ├── bootstrap.py     # synthetic 7-day pre-roll + initial fit
│   │   ├── anomaly.py       # IsolationForest per resident, joblib persistence
│   │   ├── trends.py        # slope-based rules
│   │   └── risk.py          # hybrid score combiner + publisher
│   ├── api/
│   │   ├── residents.py     # GET list, GET detail, GET history
│   │   ├── alerts.py        # GET list, POST ack, POST resolve
│   │   └── scenarios.py     # POST inject scenario (proxies sim)
│   ├── storage/
│   │   ├── redis.py         # last-state cache wrapper
│   │   └── influx.py        # write/query helpers
│   └── models.py            # pydantic schemas
└── tests/
    └── test_rules.py        # 3 unit tests on alerts/rules.py
```

### 6.1 Alert Engine — 5 levels

Threshold rules (`rules.py`):

| Level | Name           | Color  | Trigger examples                                                       |
| ----- | -------------- | ------ | ---------------------------------------------------------------------- |
| 1     | Information    | Blue   | Resident inactive > 30 min                                             |
| 2     | Attention      | Yellow | HR > baseline +15%, SpO2 88–92%, routine deviation                     |
| 3     | Alerte         | Orange | SpO2 < 93% sustained 2 min, no motion 1h, ML risk > 0.6                |
| 4     | Urgence        | Red    | Fall pattern, HR < 40 or > 140, SpO2 < 88%                             |
| 5     | Danger vital   | Black  | Cardiac arrest pattern (no motion + critical vitals), or unacked L4    |

**Engine cycle (every 1s):**

1. Read latest state per resident from Redis.
2. Run rules → candidate level.
3. Compare with active alert: if higher → escalate; if same → refresh; if lower → no change (alerts are sticky until acked).
4. Persist alerts in Redis (active set) and InfluxDB (audit log).
5. Publish to `ehpad/alerts/new` or `ehpad/alerts/update/<id>`.

### 6.2 Auto-Escalation (S4)

Per-alert deadline timers (asyncio scheduled tasks indexed by `alert_id`):

- L2 → L3 if unacked for 10 min
- L3 → L4 if unacked for 5 min
- L4 → L5 if unacked for 3 min

Acking an alert cancels its timer.

**Demo mode** (`DEMO_MODE=true` env var on backend + simulator):

- Escalation deadlines divided by 10: L2→L3 in 60 s, L3→L4 in 30 s, L4→L5 in 18 s.
- `degradation` scenario in the simulator compresses its 30-min vitals drift into ~3 min.
- ML refit interval reduced from 6 h → 5 min so live retraining is observable during the demo.
- Logged loudly at boot: `WARNING: DEMO_MODE active — do not run in production`.
- README documents how to disable for prod deployments.

### 6.3 ML Prediction (S1) — hybrid

**Bootstrap (offline, mandatory before live ingest can score):**

- On first backend boot, generate 7 days of synthetic "normal" data per resident using each profile's baseline + circadian drift + activity bands.
- Train one `IsolationForest` per resident on that synthetic dataset.
- Persist each model to the `/models` Docker volume as `<resident_id>.joblib` (joblib).
- On subsequent boots, reload from `/models` if present; otherwise re-bootstrap.
- This guarantees S1 works at minute 0 of the demo, not after 24h of live data.

**Live operation:**

- Anomaly: pre-trained model scored against the rolling 15-min window from Redis (`ml:window:<resident_id>`).
- Trend rules: slope of HR / SpO2 / temp over the last 15 min; rising/falling deltas scored 0–1.
- Combined risk score: `risk = 0.6 * anomaly_score + 0.4 * trend_score`.
- Published every 30 s on `ehpad/risk/resident/<id>`, also written to `state:resident:<id>.risk` in Redis (TTL 60 s).
- Refit per resident every 6 h, blending the synthetic bootstrap data with the latest live window. New model overwrites `/models/<resident_id>.joblib`.

**Risk freshness vs alert engine cadence:**

- Alert engine cycles at 1 s and reads `state:resident:<id>.risk` from Redis (last published score).
- Engine never recomputes ML on its own — it only consumes the cached score.
- Acceptable staleness: up to 30 s (publishing interval). Justified because the prediction horizon is 30–60 min, so a 30 s lag on the input is negligible.
- If `risk` field is missing or older than 60 s (TTL expired), the engine treats the resident as "no ML signal" and falls back to threshold-only rules.

Risk > 0.6 contributes to the L3 trigger in `rules.py`.

## 7. Storage

### 7.1 Redis (last state + active alerts + ML rolling window)

```
state:resident:<id>       → JSON: latest vitals, motion, risk, last_seen   (TTL 60s)
state:room:<room_id>      → JSON: PIR + door + occupants                    (TTL 60s)
alerts:active             → SET of alert_ids                                (no TTL)
alerts:active:<id>        → JSON: id, resident_id, level, triggered_at, ack_status, deadline  (no TTL, cleared on resolve)
ml:window:<resident_id>   → LIST capped 15 min × 1 Hz = 900 entries (LPUSH + LTRIM)
```

State keys TTL: 60 s, refreshed on each ingest (used by alert engine for risk freshness check).
Active alerts have no TTL — explicitly cleared on resolve.

**ML models are NOT stored in Redis.** They live on the `/models` Docker volume as `<resident_id>.joblib` files (see §6.3). Redis only holds the live rolling window used for inference.

### 7.2 InfluxDB (history)

| Bucket          | Retention |
| --------------- | --------- |
| `ehpad_vitals`  | 30 d      |
| `ehpad_motion`  | 7 d       |
| `ehpad_ambient` | 7 d       |
| `ehpad_alerts`  | 1 y (audit) |

Measurements:

```
vitals    tags: resident_id           fields: hr, spo2, sys, dia, temp
motion    tags: resident_id           fields: ax, ay, az, activity
ambient   tags: room_id, type         fields: value
alerts    tags: resident_id, level, status   fields: triggered_at, acked_at, resolved_at, message
risk      tags: resident_id           fields: anomaly, trend, combined
```

**Write strategy:** batched writes to Influx every 1s (~120 points). Redis writes are synchronous on each MQTT message (single SETEX). The ML rolling window is updated via LPUSH + LTRIM on every ingest.

**Query patterns from front:**

- Grid live: pushed via WebSocket, no DB read.
- Drill-down history: `GET /residents/:id/history?from=&to=&metric=` → InfluxDB Flux query.
- Alert log: `GET /alerts?resident_id=&level=` → InfluxDB.

## 8. WebSocket Gateway

Node.js process. Subscribes Mosquitto on:

```
ehpad/state/+
ehpad/alerts/#
ehpad/risk/+
```

Broadcasts each message as JSON over a single WebSocket endpoint (`/ws`) with topic-tagged envelopes:

```json
{"topic": "alerts/new", "data": { ... }}
```

No auth in scope. No write path. Single file (`ws-gateway/server.js`), ~100 LOC.

## 9. Front-end (M4)

**Routes:**

```
/                      → grid view (all residents)
/resident/:id          → drill-down (charts, alerts, profile)
/alerts                → alert log (filterable)
```

**Component layout:**

```
frontend/src/
├── App.tsx
├── pages/
│   ├── Grid.tsx
│   ├── ResidentDetail.tsx
│   └── AlertLog.tsx
├── components/
│   ├── ResidentCard.tsx     # tile in grid
│   ├── VitalGauge.tsx       # HR / SpO2 / temp dial
│   ├── AlertBadge.tsx       # color-coded by level
│   ├── AlertToast.tsx       # popup + sound on new high-level alert
│   ├── VitalChart.tsx       # recharts time-series
│   └── AckButton.tsx
├── hooks/
│   ├── useWebSocket.ts      # connects ws://gateway:8080, dispatches events
│   ├── useResidents.ts      # SWR /residents, merges WS updates
│   └── useAlerts.ts         # SWR /alerts/active, merges WS updates
├── store/
│   └── store.ts             # zustand: residents map, alerts map
└── lib/
    └── api.ts
```

**Grid view (main demo screen):**

- 4×5 grid of `ResidentCard` (20 residents).
- Each card: name, room, age, vitals (HR / SpO2 mini), motion icon, ML risk gauge, alert ring (color = level).
- Sorted by alert level descending.
- Click → drill-down.

**Drill-down:**

- Profile + current state header.
- Three charts: vitals (24h), motion activity, risk timeline.
- Alert history table with ack / resolve.
- Scenario inject buttons (fall / cardiac / degradation) for demo.

**Alert UX:**

- Toast on new alert ≥ L3 with sound (Web Audio).
- Color codes: L1 blue, L2 yellow, L3 orange, L4 red, L5 black (pulsing).
- Ack button on toast and on card; ack = `POST /alerts/:id/ack`.

**Real-time:** WebSocket connects on mount. `useWebSocket` reducer updates the zustand store. End-to-end latency MQTT → UI < 200 ms.

## 10. Docker Compose (M6)

`docker-compose.yml`:

```yaml
services:
  mosquitto:
    image: eclipse-mosquitto:2
    ports: ["1883:1883"]
    volumes: [./mosquitto/config:/mosquitto/config]
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "mosquitto_sub -h localhost -t '$$SYS/#' -C 1 -E -i healthcheck -W 3"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: [redis-data:/data]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  influxdb:
    image: influxdb:2.7
    ports: ["8086:8086"]
    environment:
      DOCKER_INFLUXDB_INIT_MODE: setup
      DOCKER_INFLUXDB_INIT_USERNAME: admin
      DOCKER_INFLUXDB_INIT_PASSWORD: ehpad-admin
      DOCKER_INFLUXDB_INIT_ORG: ehpad
      DOCKER_INFLUXDB_INIT_BUCKET: ehpad_vitals
      DOCKER_INFLUXDB_INIT_ADMIN_TOKEN: ehpad-token-dev
    volumes: [influx-data:/var/lib/influxdb2]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "influx", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    ports: ["8000:8000"]
    depends_on:
      mosquitto: { condition: service_healthy }
      redis:     { condition: service_healthy }
      influxdb:  { condition: service_healthy }
    environment:
      MQTT_HOST: mosquitto
      REDIS_URL: redis://redis:6379
      INFLUX_URL: http://influxdb:8086
      INFLUX_TOKEN: ehpad-token-dev
      INFLUX_ORG: ehpad
      DEMO_MODE: "true"
    volumes: [models:/models]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 10

  simulator:
    build: ./simulator
    depends_on:
      mosquitto: { condition: service_healthy }
      backend:   { condition: service_healthy }
    environment:
      MQTT_HOST: mosquitto
      RESIDENT_COUNT: 20
      DEMO_MODE: "true"
    restart: unless-stopped

  ws-gateway:
    build: ./ws-gateway
    ports: ["8080:8080"]
    depends_on:
      mosquitto: { condition: service_healthy }
    environment:
      MQTT_HOST: mosquitto
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  frontend:
    build: ./frontend
    ports: ["3000:80"]
    depends_on:
      backend:    { condition: service_healthy }
      ws-gateway: { condition: service_healthy }
    environment:
      VITE_API_URL: http://localhost:8000
      VITE_WS_URL: ws://localhost:8080
    restart: unless-stopped

volumes:
  redis-data:
  influx-data:
  models:
```

Backend exposes `GET /health` (returns 200 once Redis + Influx + MQTT subscribers are connected). ws-gateway exposes `GET /health` (returns 200 once MQTT subscribed). These gate every dependent service through `condition: service_healthy`, eliminating boot races at demo time.

**Project tree:**

```
projet2-iot-sante/
├── docker-compose.yml
├── README.md
├── docs/
│   ├── architecture.md
│   └── api.md
├── mosquitto/config/mosquitto.conf
├── simulator/        # Dockerfile, Python
├── backend/          # Dockerfile, Python (FastAPI)
├── ws-gateway/       # Dockerfile, Node
└── frontend/         # Dockerfile (multi-stage build → nginx)
```

**Launch:** `docker compose up --build` → frontend at http://localhost:3000.

## 11. Demo Scenario (8 min)

1. Open dashboard, show 20 residents normal (1 min).
2. Trigger `degradation` on R007 — vitals slowly drift, ML risk climbs (2 min).
3. Risk crosses 0.6 → L3 alert turns orange — show ML predicted before threshold (1 min).
4. Don't ack → escalates to L4 in 5 min (or fast-forward via debug button).
5. Trigger `fall` on R012 — instant L4 red, sound, toast (1 min).
6. Ack on R012, resolve, show audit log via InfluxDB query (1 min).
7. Drill-down R007 — show charts, history, risk timeline (1 min).
8. Q&A architecture (1 min).

## 11.5. Observability & Tests

**Structured logging (all Python services):**

- `structlog` configured for JSON output to stdout.
- Required context fields on every log line where applicable: `service`, `resident_id`, `alert_id`, `level`, `event`.
- Levels: `info` for ingest/state changes, `warning` for threshold crossings, `error` for backend failures, `critical` for L4/L5 alerts.
- Compose collects logs via standard Docker driver — `docker compose logs -f backend` streams readable JSON.

**Minimal test surface (signal of rigor for Q&A, no full coverage):**

- `backend/tests/test_rules.py` — 3 unit tests on `alerts/rules.py`:
  - `test_l3_triggered_by_low_spo2` — input state with SpO2 = 91% sustained → returns level 3.
  - `test_l4_triggered_by_fall_pattern` — input motion vector matching fall heuristic → returns level 4.
  - `test_l5_escalation_from_unacked_l4` — feed unacked L4 past deadline → returns level 5.
- Run with `pytest` in the backend container.
- Documented in README under "Tests".
- Out of scope: integration tests, front-end tests, coverage targets.

## 12. Documentation (M7)

- `README.md` — install Docker, run `docker compose up`, open localhost:3000, "Try scenarios" section, troubleshooting.
- `docs/architecture.md` — diagram, service responsibilities, MQTT topics, justification of choices (Redis + Influx, Node bridge, hybrid ML).
- `docs/api.md` — REST endpoints, payloads, MQTT topic schema, alert level matrix, error codes.

## 13. Out of Scope

- **S2 plan EHPAD (visual map)** — explicitly excluded. Trade-off: +1 should-have point vs ~1 day solo work to design SVG floor plan, room layout JSON, position projection from PIR, and drag/zoom UI. With scope locked to MUST + S1 + S4, the time is better spent polishing the ML demo (3 pts ML doc + S1 + central demo scenario). May be re-added in a follow-up sub-project if time remains.
- S3 routine history learned per resident.
- S5 staff assignment & notification routing.
- C1–C5 (fugue detection, LLM summary, family interface, routine analysis, automated tests beyond the 3 smoke tests).
- Authentication / authorization.
- Mobile app.
- Production-grade observability beyond JSON stdout logs and the InfluxDB audit bucket.

## 14. Risks & Mitigations

| Risk                                     | Mitigation                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| ML cold start (no history at boot)       | Backend bootstrap (§6.3): generate 7 days of synthetic normal data per resident, train one IsolationForest each, persist to `/models` volume. ML works at minute 0. |
| MQTT message storm (>120 msg/s)          | Batched Influx writes; Redis SETEX is O(1).                               |
| WebSocket reconnect floods               | Exponential backoff in `useWebSocket`; ws-gateway tolerates churn.        |
| Demo scenario timing                     | `DEMO_MODE` env var (§6.2): escalation deadlines ÷10, scenario drifts compressed. README warns prod must disable. |
| Boot race conditions (services not ready)| Compose healthchecks on mosquitto/redis/influxdb; `condition: service_healthy` gates dependents (§10). |
| Single-process simulator CPU             | 20 residents × 6 Hz combined ≈ 120 msg/s — well within asyncio capacity.   |

## 15. Build Order (sub-projects)

Each subsequent step has its own implementation plan in `docs/superpowers/plans/`:

1. Infra scaffold (Compose, Mosquitto, Redis, Influx, project tree).
2. Simulator (residents + sensors + scenarios).
3. Backend ingest + storage (Redis, Influx).
4. Alert engine + escalation.
5. WebSocket gateway.
6. Front-end grid + drill-down + WS hookup.
7. ML hybrid risk + integration with alert L3 trigger.
8. Documentation + demo polish.
