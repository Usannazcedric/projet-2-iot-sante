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

See `docs/infra-quickstart.md` for troubleshooting.
