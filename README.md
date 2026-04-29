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

See `docs/infra-quickstart.md` for troubleshooting.
