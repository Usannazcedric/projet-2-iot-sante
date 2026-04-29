# Infra Quickstart

This doc covers bringing up the EHPAD infrastructure stack: Mosquitto, Redis, InfluxDB. Application services (simulator, backend, ws-gateway, frontend) are added by later sub-projects.

## Prerequisites

- Docker Desktop or Docker Engine ≥ 24
- Docker Compose v2 (built into modern Docker)
- Free TCP ports on the host: `1883` (Mosquitto), `6379` (Redis), `8086` (InfluxDB)

## Bring it up

```bash
docker compose up -d
docker compose ps
```

Wait until all three services show `(healthy)` in the `STATUS` column. Initial startup takes 15–30 s on first run because InfluxDB provisions the org, bucket, and admin token.

## Verify

```bash
# All healthcheck statuses
for s in mosquitto redis influxdb; do
  echo "$s: $(docker inspect --format '{{.State.Health.Status}}' ehpad-$s)"
done
```

Expected: each prints `healthy`.

## Smoke tests

```bash
# Mosquitto pub/sub round-trip
docker exec ehpad-mosquitto mosquitto_sub -h localhost -t 'ehpad/smoke' -C 1 -W 5 &
sleep 1
docker exec ehpad-mosquitto mosquitto_pub -h localhost -t 'ehpad/smoke' -m 'ok'
wait

# Redis
docker exec ehpad-redis redis-cli ping        # → PONG

# InfluxDB
docker exec ehpad-influxdb influx ping        # → OK
docker exec ehpad-influxdb influx bucket list \
  --token ehpad-token-dev --org ehpad         # → list includes ehpad_vitals
```

## Stop / clean

```bash
docker compose down            # stop, keep volumes
docker compose down -v         # stop and DELETE all data volumes
```

## Troubleshooting

**Port already in use** — another service is bound to 1883/6379/8086. Either stop it, or change the host-side mapping in `docker-compose.yml` (left side of the `ports:` colon).

**InfluxDB stuck `unhealthy`** — first-run setup may take longer than the healthcheck `start_period`. Check logs: `docker compose logs influxdb`. If you see "already initialized" but the bucket is missing, the volume has stale state. Reset with: `docker compose down -v && docker compose up -d influxdb`.

**Mosquitto immediately exits** — verify `mosquitto/config/mosquitto.conf` is mounted read-only and is valid: `docker compose logs mosquitto`. Most common cause is a typo in the config file.

**Redis healthcheck fails** — Redis pings via `redis-cli ping`. If it fails, the image may be misconfigured. Check: `docker compose logs redis`.

## Configuration

InfluxDB defaults are baked into `docker-compose.yml`:

| Variable                | Value             |
| ----------------------- | ----------------- |
| Org                     | `ehpad`           |
| Bucket                  | `ehpad_vitals`    |
| Admin user              | `admin`           |
| Admin password          | `ehpad-admin`     |
| Admin token             | `ehpad-token-dev` |

These are **dev-only**. Production setups must use Docker secrets or an external secret store.
