# Architecture

End-to-end view of the EHPAD Health Monitoring stack. For per-endpoint reference see `docs/api.md`. For the demo runbook see `docs/demo.md`.

## Service map

```
                 ┌─────────────┐                ┌──────────────┐
                 │ Simulator   │  MQTT publish  │   Mosquitto  │
                 │ (asyncio)   │ ─────────────▶ │   (broker)   │
                 │ 20 residents│                │              │
                 │ HTTP 9100   │                └──────┬───────┘
                 └─────────────┘                       │
                       ▲                               │ subscribe
                       │ POST /scenario/{id}           ▼
                       │                  ┌────────────────────────┐
                       │                  │  Backend (FastAPI)     │
                       │                  │  - MQTT ingest         │
                       │                  │  - Alert engine (1 Hz) │
                       │                  │  - Risk publisher (30s)│
                       │                  │  - REST API 8000       │
                       │                  └──┬────────┬────────────┘
                       │                     │        │
                       │              cache ▼        ▼ history + audit
                       │             ┌────────┐  ┌────────────────┐
                       │             │ Redis  │  │   InfluxDB     │
                       │             │ state  │  │ vitals/motion  │
                       │             │ window │  │ alerts/risk    │
                       │             │ alerts │  │                │
                       │             └────────┘  └────────────────┘
                       │
                       │                  ┌────────────────────┐
                       │                  │   ws-gateway       │
                       │                  │   (Node + mqtt + ws)│
                       │                  │   subscribes        │
                       │                  │   alerts/state/risk │
                       │                  │   broadcasts /ws    │
                       │                  └─────────┬──────────┘
                       │                            │
                       │                            │
                  ┌────┴───────────────┐            │
                  │   Frontend (nginx) │  /ws WS    │
                  │   /api → backend   │ ◀──────────┘
                  │   /sim → simulator │
                  │   /ws  → ws-gateway│
                  │   :3000            │
                  └────────────────────┘
                          ▲
                          │
                   browser (operator)
```

## Service responsibilities

| Service       | Image / runtime          | Port | Purpose                                                                 |
| ------------- | ------------------------ | ---- | ----------------------------------------------------------------------- |
| `mosquitto`   | `eclipse-mosquitto:2`    | 1883 | MQTT broker between simulator, backend, ws-gateway                      |
| `redis`       | `redis:7-alpine`         | 6379 | Hot state (`state:resident:<id>` 60 s TTL), active alerts, ML window    |
| `influxdb`    | `influxdb:2.7`           | 8086 | Time-series history: `vitals`, `motion`, `alerts`, `risk`               |
| `simulator`   | Python asyncio + FastAPI | 9100 | Synthetic vitals/motion for 20 residents, scenario injection            |
| `backend`     | Python FastAPI           | 8000 | MQTT ingest → Redis + Influx; alert engine; risk publisher; REST API    |
| `ws-gateway`  | Node 20 + ws + mqtt      | 8080 | Subscribes MQTT, broadcasts `{topic, data}` envelopes to WebSocket peers |
| `frontend`    | nginx 1.27               | 3000 | React SPA served by nginx with reverse-proxies for `/api`, `/sim`, `/ws` |

All services run with healthchecks; compose `condition: service_healthy` gates dependents to avoid boot races.

## MQTT topic structure

Publisher → consumer table.

| Topic                          | Publisher  | Consumers              | QoS | Notes                                       |
| ------------------------------ | ---------- | ---------------------- | --- | ------------------------------------------- |
| `ehpad/vitals/resident/<id>`   | simulator  | backend                | 0   | 1 Hz per resident                           |
| `ehpad/motion/resident/<id>`   | simulator  | backend                | 0   | 5 Hz per resident                           |
| `ehpad/state/resident/<id>`    | backend    | ws-gateway             | 0   | Republished merged state for WS clients     |
| `ehpad/alerts/new`             | backend    | ws-gateway             | 1   | New alert payload                           |
| `ehpad/alerts/update/<id>`     | backend    | ws-gateway             | 1   | Status / level change                       |
| `ehpad/risk/resident/<id>`     | backend    | ws-gateway             | 0   | 30 s cadence, anomaly + trend + combined    |

ws-gateway subscriptions: `ehpad/alerts/#`, `ehpad/state/#`, `ehpad/risk/#` (3-level wildcard required for risk).

## Data flow per vitals sample

1. Simulator publishes `ehpad/vitals/resident/R007` (1 Hz).
2. Backend `MqttClient` callback dispatches to `ingest.handlers._handle_vitals`.
3. Handler:
   - Validates payload (`VitalsPayload` Pydantic model).
   - `cache.merge_resident_state(...)` — writes to Redis `state:resident:R007` with 60 s TTL.
   - `cache.push_ml_window(...)` — LPUSH + LTRIM 900 entries on `ml:window:R007`.
   - `influx.write_vitals(...)` — async write to `vitals` measurement.
   - Republishes merged state on `ehpad/state/resident/R007` for ws-gateway.
4. Alert engine (1 Hz loop) reads each resident state, evaluates `rules.py`, creates / escalates / refreshes alerts via `AlertStore`. New / changed alerts publish via `AlertPublisher`.
5. Risk publisher (30 s loop) reads each window, scores anomaly (IsolationForest) + trend (slope), combines `0.6 * a + 0.4 * t`, merges into Redis state, publishes `ehpad/risk/resident/<id>`, audits Influx.
6. ws-gateway forwards as JSON envelope `{"topic": "state/resident/R007" | "alerts/new" | "risk/resident/R007", "data": {...}}` to WebSocket clients.
7. Frontend store dispatches by topic prefix: state → `setResident`, alerts → `upsertAlert` + toast (level ≥ 3), risk → `setResident({risk})`.

## Key tech choices

- **Redis + Influx split** — Redis for O(1) hot state and the ML window; Influx for batched historical queries. Avoids putting a 20 res × 1 Hz × multi-day load on a single store.
- **In-process ML** (no separate service) — IsolationForest models are tiny (≤ 1 MB each) and load lazily; an extra container would have added orchestration without throughput benefit.
- **Synthetic bootstrap** — IF training on 7 d × 1 sample/min synthetic baseline at first boot guarantees S1 works at minute 0 of the demo. Live refit (planned every 6 h) is currently out of scope; bootstrap-once is sufficient for the demo horizon.
- **Node ws-gateway** — decouples real-time fan-out from heavy ingest in the backend; ws/mqtt libs handle many concurrent subscribers cheaply.
- **nginx same-origin** — `/api`, `/sim`, `/ws` all proxied through `frontend:80`; the browser never crosses origins, so no CORS or token plumbing is needed for the demo.
- **paho-mqtt VERSION2 callback API** — the asyncio loop is captured in `__init__`; the paho thread schedules work onto it via `run_coroutine_threadsafe`.
- **Sticky alerts** — `AlertStore` only escalates; never downgrades. Resolves remove from the active set entirely. Prevents flapping under noisy thresholds.

## Demo-mode caveats

`DEMO_MODE=true` (set on `simulator` and `backend` in `docker-compose.yml`):

- Escalation deadlines divided by 10: L2→L3 in 60 s, L3→L4 in 30 s, L4→L5 in 18 s.
- `degradation` scenario in the simulator compresses its 30-min vitals drift into ~3 min.
- A `WARNING: DEMO_MODE active` line is logged at boot.
- Production must set `DEMO_MODE=false` (or omit it).

## Test surface

`backend/tests/` — 59 pytest tests covering:

- `test_rules.py`, `test_store.py`, `test_engine.py`, `test_escalation.py`, `test_alerts_api.py` — alert engine end-to-end.
- `test_handlers.py`, `test_redis.py` — ingest pipeline.
- `test_ml_window.py`, `test_bootstrap.py`, `test_anomaly.py`, `test_trend.py`, `test_risk.py` — ML stack.
- `test_health.py`, `test_residents_api.py` — REST surface.

Run: `cd backend && source .venv/bin/activate && pytest -q`.

Out of scope for v1: integration tests across services, frontend tests (Vitest), coverage targets.
