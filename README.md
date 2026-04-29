# Projet 2 — EHPAD Health Monitoring (IoT/IA)

Real-time monitoring for 20 EHPAD residents. Live MQTT ingest, hybrid ML risk scoring (IsolationForest + trend slope), 5-level alerts with auto-escalation, React dashboard.

**Stack:** Python FastAPI + asyncio simulator, Node WebSocket gateway, React + Vite + TS + Tailwind front, Mosquitto, Redis, InfluxDB, scikit-learn. Everything runs as one `docker compose up`.

## Demo in 60 seconds

```bash
docker compose up -d --build
# wait for 7 services healthy, then open the dashboard
until [ "$(docker compose ps --format '{{.State}} {{.Health}}' | grep -c 'running healthy')" = "7" ]; do sleep 3; done
open http://localhost:3000
```

Trigger a slow degradation; ML predicts before any threshold is crossed:

```bash
curl -fsS -X POST http://localhost:3000/sim/scenario/R007 \
  -H 'Content-Type: application/json' -d '{"name":"degradation"}'
```

Trigger an acute fall:

```bash
curl -fsS -X POST http://localhost:3000/sim/scenario/R012 \
  -H 'Content-Type: application/json' -d '{"name":"fall"}'
```

## Documentation

- **`docs/architecture.md`** — service map, data flow, tech choices.
- **`docs/api.md`** — REST + MQTT + WebSocket reference.
- **`docs/demo.md`** — 8-minute demo script.
- **`docs/infra-quickstart.md`** — troubleshooting for the infra layer.
- **`docs/superpowers/specs/2026-04-29-ehpad-monitoring-design.md`** — original design spec.
- **`docs/superpowers/plans/`** — per-sub-project implementation plans.

## Tests

```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q                       # 59 tests, ~2 s
```

---

## Sub-project history (build order)

The system was built incrementally. Each step shipped as its own tag.

## Infra (sub-project 1 — landed, tag `infra-v0.1`)

```bash
docker compose up -d
docker compose ps
```

You should see three services healthy: `mosquitto`, `redis`, `influxdb`.

Smoke checks:

```bash
docker exec ehpad-mosquitto mosquitto_sub -h localhost -t 'ehpad/test' -C 1 -W 5 &
sleep 1
docker exec ehpad-mosquitto mosquitto_pub -h localhost -t 'ehpad/test' -m 'hello'
wait
docker exec ehpad-redis redis-cli ping        # → PONG
docker exec ehpad-influxdb influx ping        # → OK
```

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

## WebSocket Gateway (sub-project 5 — landed)

Node bridge that subscribes MQTT and broadcasts envelopes to WebSocket clients.

```bash
docker compose up -d --build ws-gateway
curl -fsS http://localhost:8080/health
```

Connect a client:

```bash
python3 - <<'EOF'
import asyncio, json, websockets
async def main():
    async with websockets.connect("ws://localhost:8080/ws") as ws:
        for _ in range(10):
            print(json.loads(await ws.recv()))
asyncio.run(main())
EOF
```

Envelope format: `{ "topic": "alerts/new", "data": { ... } }`. Topic strips the `ehpad/` prefix.

Subscribed MQTT patterns: `ehpad/alerts/#`, `ehpad/state/#`, `ehpad/risk/+`.

## Frontend (sub-project 6 — landed)

React + Vite + TypeScript + Tailwind dashboard. Same-origin via nginx; reverse-proxies `/api`, `/sim`, `/ws` so the browser never touches CORS.

```bash
docker compose up -d --build
open http://localhost:3000
```

Routes:

- `/` — grid of 20 residents (sorted by alert level desc, then id)
- `/resident/:id` — drill-down with vitals, recharts time-series, active alerts (Ack/Resolve), scenario controls
- `/alerts` — alert log with level filter and Ack/Resolve actions

Live updates via WebSocket envelopes from ws-gateway. Initial state via REST.

## ML Risk (sub-project 7 — landed)

Hybrid risk score per resident, updated every 30 s.

- **Anomaly**: one IsolationForest per resident, bootstrapped from synthetic 7-day vitals at first startup, persisted to the `models-data` volume as `<id>.joblib`.
- **Trend**: slope of HR / SpO2 / temp over the latest 15-minute window from Redis (`ml:window:<id>`, LPUSH+LTRIM 900).
- **Combined**: `risk = 0.6 * anomaly + 0.4 * trend`, written into `state:resident:<id>.risk`, published on `ehpad/risk/resident/<id>` (qos 0), audited in Influx (`risk` measurement).

Verify it scores:

```bash
docker compose up -d --build
sleep 90
curl -fsS http://localhost:8000/residents/R001 | python3 -m json.tool | grep -i risk
```

Watch live risk envelopes via the gateway:

```bash
docker exec ehpad-mosquitto mosquitto_sub -h localhost -t 'ehpad/risk/#' -v
```

Trigger a degradation and watch the risk climb:

```bash
curl -fsS -X POST http://localhost:9100/scenario/R007 \
  -H 'Content-Type: application/json' -d '{"name":"degradation"}'
```

Frontend: a risk pill on the grid card (yellow ≥ 0.3, orange ≥ 0.6) and a Risk gauge on the drill-down page.

Risk freshness: 60 s TTL on the resident state. If the publisher loop falls behind, the alert engine falls back to threshold-only rules.

See `docs/infra-quickstart.md` for troubleshooting.
