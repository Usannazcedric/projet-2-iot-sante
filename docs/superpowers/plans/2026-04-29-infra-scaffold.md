# Infra Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the project tree and a working `docker-compose.yml` that brings Mosquitto, Redis, and InfluxDB up healthy and reachable. No application code yet — this plan only covers shared infra so subsequent sub-projects (simulator, backend, ws-gateway, frontend) plug into a stable base.

**Architecture:** Three infrastructure services orchestrated by Docker Compose, each with healthchecks and persistent volumes where applicable. Mosquitto exposes 1883 (MQTT). Redis exposes 6379. InfluxDB exposes 8086 with bucket `ehpad_vitals` pre-provisioned via env. All services use a shared compose network. No application services in this plan — they are added by later sub-project plans.

**Tech Stack:** Docker, Docker Compose v2, Eclipse Mosquitto 2, Redis 7-alpine, InfluxDB 2.7.

---

## Reference

- Spec: `docs/superpowers/specs/2026-04-29-ehpad-monitoring-design.md` — sections §3 (architecture), §4 (MQTT topics), §7 (storage), §10 (compose).
- Build order: §15, this plan covers step 1 only.
- Out of scope for this plan: simulator, backend, ws-gateway, frontend, healthchecks of those services, models volume.

## File Structure

This plan creates the following:

```
projet2-iot-sante/
├── README.md                       # quickstart for infra (will grow over sub-projects)
├── docker-compose.yml              # 3 services: mosquitto, redis, influxdb
├── .env.example                    # documents env vars (InfluxDB token, etc.)
├── mosquitto/
│   └── config/
│       └── mosquitto.conf          # listener 1883, allow anonymous (dev only)
└── docs/
    └── infra-quickstart.md         # how to bring up infra and verify
```

Each file's responsibility:

- `docker-compose.yml` — orchestrates the 3 infra services with healthchecks, restart policy, network, volumes. No application services yet.
- `mosquitto/config/mosquitto.conf` — broker config: TCP listener 1883, anonymous access (dev only — flagged as such).
- `.env.example` — env vars (`INFLUX_ADMIN_TOKEN`, etc.) duplicated as defaults inside compose; the file is a documentation aid and is not loaded by compose in this plan.
- `README.md` — minimal quickstart focused on bringing infra up and the three smoke checks.
- `docs/infra-quickstart.md` — one-page operator-facing doc: prerequisites, commands, troubleshooting (port conflicts, healthcheck failure).

## Pre-Flight

- [ ] **Step 0.1: Verify Docker + Compose available**

Run: `docker --version && docker compose version`

Expected: both print version strings, no error. If absent, install Docker Desktop or Docker Engine + plugin.

- [ ] **Step 0.2: Verify ports 1883, 6379, 8086 are free on host**

Run: `lsof -iTCP -sTCP:LISTEN -nP | grep -E ':(1883|6379|8086)\b' || echo "ports free"`

Expected: prints `ports free`. If any port is in use, stop the conflicting process or change the host-side mapping in `docker-compose.yml` and update `docs/infra-quickstart.md`.

- [ ] **Step 0.3: Confirm working directory**

Run: `pwd`

Expected: ends with `/projet 2 iot Santé`. All commands below assume this is the repo root.

---

## Task 1: Create project tree skeleton

**Files:**
- Create: `mosquitto/config/.gitkeep`
- Create: `.env.example`
- Modify: `README.md` (created if missing)

- [ ] **Step 1.1: Create directory layout**

Run:
```bash
mkdir -p mosquitto/config docs
touch mosquitto/config/.gitkeep
```

Expected: directories `mosquitto/config/` and `docs/` exist, plus an empty `.gitkeep` so the empty dir can be committed.

- [ ] **Step 1.2: Write `.env.example`**

File: `.env.example`

```dotenv
# Copy to .env (not committed) for local overrides — compose currently bakes defaults inline.
INFLUX_USERNAME=admin
INFLUX_PASSWORD=ehpad-admin
INFLUX_ORG=ehpad
INFLUX_BUCKET=ehpad_vitals
INFLUX_ADMIN_TOKEN=ehpad-token-dev
```

- [ ] **Step 1.3: Write minimal `README.md`**

File: `README.md`

````markdown
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
docker exec -it $(docker compose ps -q mosquitto) mosquitto_sub -h localhost -t 'ehpad/test' -C 1 -W 5 &
docker exec -it $(docker compose ps -q mosquitto) mosquitto_pub -h localhost -t 'ehpad/test' -m 'hello'
docker exec -it $(docker compose ps -q redis) redis-cli ping        # → PONG
docker exec -it $(docker compose ps -q influxdb) influx ping        # → OK
```

Stop everything:

```bash
docker compose down
```

See `docs/infra-quickstart.md` for troubleshooting.
````

- [ ] **Step 1.4: Verify tree**

Run: `ls -1 && ls -1 mosquitto/config && ls -1 docs`

Expected output includes `README.md`, `.env.example`, `docker-compose.yml` not yet present (Task 2), `mosquitto/config/.gitkeep`, `docs/superpowers/` already there.

- [ ] **Step 1.5: Commit**

```bash
git add README.md .env.example mosquitto/config/.gitkeep
git commit -m "chore(infra): project tree skeleton and README"
```

---

## Task 2: Mosquitto service in Compose with healthcheck

**Files:**
- Create: `mosquitto/config/mosquitto.conf`
- Create: `docker-compose.yml` (mosquitto service only at this step)

- [ ] **Step 2.1: Write Mosquitto config**

File: `mosquitto/config/mosquitto.conf`

```conf
# Dev-only configuration. Anonymous access is enabled for local development.
# DO NOT use this configuration in production.
persistence true
persistence_location /mosquitto/data/

log_dest stdout
log_type all

listener 1883 0.0.0.0
allow_anonymous true
```

- [ ] **Step 2.2: Create `docker-compose.yml` with the Mosquitto service**

File: `docker-compose.yml`

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

volumes:
  mosquitto-data:
```

Note: the doubled `$$` escapes the literal `$SYS` topic name through compose variable expansion.

- [ ] **Step 2.3: Bring it up**

Run:
```bash
docker compose up -d mosquitto
docker compose ps
```

Expected: `mosquitto` container appears with `STATUS` column eventually showing `Up X seconds (healthy)` after the first healthcheck cycle (≤30 s).

- [ ] **Step 2.4: Smoke test pub/sub**

Run in two terminals (or use `&`):
```bash
docker exec ehpad-mosquitto mosquitto_sub -h localhost -t 'ehpad/test' -C 1 -W 5 &
SUB_PID=$!
sleep 1
docker exec ehpad-mosquitto mosquitto_pub -h localhost -t 'ehpad/test' -m 'hello'
wait $SUB_PID
```

Expected: subscriber prints `hello` and exits 0.

- [ ] **Step 2.5: Verify healthcheck reports healthy**

Run: `docker inspect --format '{{.State.Health.Status}}' ehpad-mosquitto`

Expected: prints `healthy`. If `starting`, wait 15 s and re-run.

- [ ] **Step 2.6: Commit**

```bash
git add mosquitto/config/mosquitto.conf docker-compose.yml
git commit -m "feat(infra): add Mosquitto service with healthcheck"
```

---

## Task 3: Redis service in Compose with healthcheck

**Files:**
- Modify: `docker-compose.yml` — add `redis` service and `redis-data` volume.

- [ ] **Step 3.1: Update `docker-compose.yml`**

File: `docker-compose.yml`

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

volumes:
  mosquitto-data:
  redis-data:
```

- [ ] **Step 3.2: Bring it up**

Run:
```bash
docker compose up -d redis
docker compose ps
```

Expected: `redis` container `Up X seconds (healthy)` within ~10 s.

- [ ] **Step 3.3: Smoke test Redis**

Run:
```bash
docker exec ehpad-redis redis-cli ping
docker exec ehpad-redis redis-cli set ehpad:smoke ok
docker exec ehpad-redis redis-cli get ehpad:smoke
docker exec ehpad-redis redis-cli del ehpad:smoke
```

Expected output:
```
PONG
OK
ok
(integer) 1
```

- [ ] **Step 3.4: Verify healthcheck**

Run: `docker inspect --format '{{.State.Health.Status}}' ehpad-redis`

Expected: `healthy`.

- [ ] **Step 3.5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(infra): add Redis service with healthcheck"
```

---

## Task 4: InfluxDB service in Compose with auto-provisioning + healthcheck

**Files:**
- Modify: `docker-compose.yml` — add `influxdb` service and `influx-data` volume.

- [ ] **Step 4.1: Update `docker-compose.yml`**

File: `docker-compose.yml`

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
      DOCKER_INFLUXDB_INIT_USERNAME: admin
      DOCKER_INFLUXDB_INIT_PASSWORD: ehpad-admin
      DOCKER_INFLUXDB_INIT_ORG: ehpad
      DOCKER_INFLUXDB_INIT_BUCKET: ehpad_vitals
      DOCKER_INFLUXDB_INIT_ADMIN_TOKEN: ehpad-token-dev
    volumes:
      - influx-data:/var/lib/influxdb2
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "influx", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

volumes:
  mosquitto-data:
  redis-data:
  influx-data:
```

- [ ] **Step 4.2: Bring it up**

Run:
```bash
docker compose up -d influxdb
docker compose ps
```

Expected: `influxdb` container takes ~10–20 s to become healthy on first start (it runs setup). Eventually `Up X seconds (healthy)`.

- [ ] **Step 4.3: Smoke test InfluxDB**

Run:
```bash
docker exec ehpad-influxdb influx ping
docker exec ehpad-influxdb influx bucket list \
  --token ehpad-token-dev \
  --org ehpad
```

Expected:
- `influx ping` prints `OK`.
- `influx bucket list` shows at least the `ehpad_vitals` bucket plus internal `_monitoring` and `_tasks`.

- [ ] **Step 4.4: Smoke test write + read**

Run:
```bash
docker exec ehpad-influxdb influx write \
  --token ehpad-token-dev \
  --org ehpad \
  --bucket ehpad_vitals \
  --precision s \
  'smoke,resident_id=R000 hr=70 1700000000'

docker exec ehpad-influxdb influx query \
  --token ehpad-token-dev \
  --org ehpad \
  'from(bucket:"ehpad_vitals") |> range(start: 0) |> filter(fn:(r)=>r._measurement=="smoke")'
```

Expected: query output contains a row with `_field=hr`, `_value=70`, `resident_id=R000`. Then clean up:

```bash
docker exec ehpad-influxdb influx delete \
  --token ehpad-token-dev \
  --org ehpad \
  --bucket ehpad_vitals \
  --start 1969-01-01T00:00:00Z \
  --stop 2099-01-01T00:00:00Z \
  --predicate '_measurement="smoke"'
```

Expected: deletion command exits 0.

- [ ] **Step 4.5: Verify healthcheck**

Run: `docker inspect --format '{{.State.Health.Status}}' ehpad-influxdb`

Expected: `healthy`.

- [ ] **Step 4.6: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(infra): add InfluxDB service with bucket auto-provisioning and healthcheck"
```

---

## Task 5: End-to-end infra verification (all three healthy)

**Files:** none — verification only.

- [ ] **Step 5.1: Tear down and bring up clean**

Run:
```bash
docker compose down
docker compose up -d
```

Expected: 3 services start. No errors in `docker compose logs --since 1m`.

- [ ] **Step 5.2: Wait for all healthy**

Run:
```bash
for i in $(seq 1 30); do
  STATUSES=$(docker compose ps --format '{{.Service}}={{.Status}}' | tr '\n' ' ')
  echo "tick $i: $STATUSES"
  if echo "$STATUSES" | grep -qE 'mosquitto=.*healthy.*redis=.*healthy.*influxdb=.*healthy|redis=.*healthy.*mosquitto=.*healthy.*influxdb=.*healthy|influxdb=.*healthy.*mosquitto=.*healthy.*redis=.*healthy' ; then
    echo "ALL HEALTHY"
    break
  fi
  sleep 2
done
```

Expected: prints `ALL HEALTHY` within 60 s. If not, inspect: `docker compose logs <service>`.

(The order-tolerant grep above can be replaced with simpler check if you prefer; example below.)

Simpler alternative:
```bash
for s in mosquitto redis influxdb; do
  echo "$s: $(docker inspect --format '{{.State.Health.Status}}' ehpad-$s)"
done
```

- [ ] **Step 5.3: Run all three smoke tests in sequence**

Run:
```bash
# Mosquitto
docker exec ehpad-mosquitto mosquitto_sub -h localhost -t 'ehpad/smoke' -C 1 -W 5 &
SUB=$!; sleep 1
docker exec ehpad-mosquitto mosquitto_pub -h localhost -t 'ehpad/smoke' -m 'ok'
wait $SUB

# Redis
docker exec ehpad-redis redis-cli ping

# InfluxDB
docker exec ehpad-influxdb influx ping
```

Expected: prints `ok` (subscriber), `PONG`, `OK`. All three commands exit 0.

- [ ] **Step 5.4: Tear down (leave volumes for dev)**

Run: `docker compose down`

Expected: containers removed. `docker volume ls | grep ehpad` still shows `mosquitto-data`, `redis-data`, `influx-data` volumes (data preserved across runs).

---

## Task 6: Operator-facing quickstart doc

**Files:**
- Create: `docs/infra-quickstart.md`

- [ ] **Step 6.1: Write `docs/infra-quickstart.md`**

File: `docs/infra-quickstart.md`

````markdown
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
````

- [ ] **Step 6.2: Verify doc renders cleanly**

Run: `cat docs/infra-quickstart.md | head -40`

Expected: shows Markdown header and prerequisites section, no obvious encoding issues.

- [ ] **Step 6.3: Commit**

```bash
git add docs/infra-quickstart.md
git commit -m "docs(infra): add infra quickstart and troubleshooting"
```

---

## Task 7: Final verification + tag

**Files:** none — verification only.

- [ ] **Step 7.1: Clean rebuild and full smoke pass**

Run:
```bash
docker compose down -v
docker compose up -d
sleep 25
for s in mosquitto redis influxdb; do
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' ehpad-$s)
  echo "$s: $STATUS"
  [ "$STATUS" = "healthy" ] || { echo "FAIL: $s not healthy"; exit 1; }
done
echo "ALL THREE HEALTHY ON CLEAN BOOT"
```

Expected: prints `ALL THREE HEALTHY ON CLEAN BOOT`. If any service fails, fix before proceeding.

- [ ] **Step 7.2: Confirm git history is clean**

Run: `git log --oneline`

Expected: at least 5 commits — initial spec commit (existed before this plan) plus tree skeleton, mosquitto, redis, influxdb, docs. No fixup, amended, or "wip" messages.

- [ ] **Step 7.3: Tag the milestone**

Run:
```bash
git tag -a infra-v0.1 -m "Infra scaffold: mosquitto + redis + influxdb healthy under compose"
git tag --list
```

Expected: `infra-v0.1` appears in the tag list.

- [ ] **Step 7.4: Tear down**

Run: `docker compose down`

Expected: containers removed; volumes persist for next sub-project.

---

## Done Criteria

The plan is complete when all of the following are true:

- `docker compose up -d` brings up `ehpad-mosquitto`, `ehpad-redis`, `ehpad-influxdb` and they all reach `healthy` within 30 s on a clean machine.
- The three smoke tests in Task 5.3 all succeed.
- `README.md` and `docs/infra-quickstart.md` describe how to run and verify the infra.
- Git history shows one commit per task (Tasks 1–4, 6) with conventional-commit style messages.
- Tag `infra-v0.1` exists.

## Self-Review

This plan covers spec sections §3 (architecture, infra layer only), §7 (storage — service provisioning), §10 (compose — three infra services with healthchecks), §12 (docs — README + infra-quickstart). Application services (simulator, backend, ws-gateway, frontend) are explicitly out of scope and live in their own sub-project plans, as does the `models` volume (introduced when the backend sub-project lands).

No placeholders, no TBDs. All commands include expected output. All file contents are complete. Type/name consistency is N/A (no code yet).
