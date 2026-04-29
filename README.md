# Projet 2 — EHPAD Health Monitoring (IoT/IA)

Real-time monitoring system for 20+ residents in an EHPAD. See the design spec at `docs/superpowers/specs/2026-04-29-ehpad-monitoring-design.md`.

## Quickstart (infra only — current state)

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

Stop everything:

```bash
docker compose down
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

See `docs/infra-quickstart.md` for troubleshooting.
