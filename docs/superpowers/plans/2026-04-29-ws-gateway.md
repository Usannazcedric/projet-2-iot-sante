# WebSocket Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Node WebSocket gateway that subscribes to MQTT broker topics (`ehpad/alerts/#`, `ehpad/state/+`, `ehpad/risk/+`) and broadcasts each message as a topic-tagged JSON envelope (`{topic, data}`) to all connected WebSocket clients on `/ws`. Add backend `ehpad/state/resident/<id>` publishing in handlers so the gateway has live state to relay. No auth, no write path, no DB. Single Node file ~120 LOC.

**Architecture:** Node 20 process. `mqtt` client connects to mosquitto, subscribes to the three topic patterns. `ws` library exposes a single `/ws` endpoint via a bare `http` server. On every MQTT message, the gateway sends a JSON envelope to every connected client. Disconnected clients are pruned automatically by `ws`. Health endpoint `GET /health` reports MQTT connection state.

**Backend addition (in scope):** Modify `app/ingest/handlers.py` to publish `ehpad/state/resident/<id>` after each Redis update. Adds ~3 lines per handler.

**Tech Stack:** Node 20, mqtt v5, ws v8, no extra deps. Docker `node:20-slim`.

---

## Reference

- Design spec: `docs/superpowers/specs/2026-04-29-ehpad-monitoring-design.md` — §3 architecture (front never talks MQTT directly), §4 alert/state topics, §8 ws-gateway contract (subscribe patterns + envelope format), §9 frontend uses `/ws`.
- Build order: step 5 of 8.
- Out of scope for this plan: frontend (6), ML risk publisher (7), final docs polish (8). Risk topic subscription works as soon as sub-7 lands; gateway needs no change.

## File Structure

```
ws-gateway/
├── Dockerfile
├── package.json
├── README.md
└── server.js
```

Plus a small modification to `backend/app/ingest/handlers.py` to publish state.

Each unit:
- `server.js` — single file: MQTT connect + subscribe, HTTP server with `/health` and `/ws` upgrade, broadcast loop. Handles JSON parse errors silently (log + drop). On MQTT disconnect, sets a flag the health endpoint reads.
- `package.json` — pinned versions, no devDependencies, `start` script.
- `Dockerfile` — `node:20-slim`, copy package + lockfile, `npm ci`, copy server.js, expose 8080, healthcheck on `/health`, run `node server.js`.
- `backend/app/ingest/handlers.py` — accept an optional `mqtt` (publisher) parameter; after `merge_resident_state`, publish updated state to `ehpad/state/resident/<id>`. Wire in `main.py`.

---

## Pre-Flight

- [ ] **Step 0.1: Confirm directory + branch**

Run: `pwd && git branch --show-current`

Expected: dir ends with `/projet 2 iot Santé`. Branch `ws-gateway`.

- [ ] **Step 0.2: Confirm Node + npm available locally for smoke (optional)**

Run: `node --version && npm --version`

Expected: Node ≥ 18 and npm ≥ 9. If missing, the smoke can run in-container only.

- [ ] **Step 0.3: Existing stack still healthy**

```bash
cd "backend" && source .venv/bin/activate && python3 -m pytest -v 2>&1 | tail -3
```

Expected: 37 passed.

---

## Task 1: ws-gateway skeleton

**Files:**
- Create: `ws-gateway/package.json`
- Create: `ws-gateway/Dockerfile`
- Create: `ws-gateway/README.md`

- [ ] **Step 1.1: Write `ws-gateway/package.json`**

```json
{
  "name": "ehpad-ws-gateway",
  "version": "0.1.0",
  "private": true,
  "description": "EHPAD WebSocket gateway: MQTT subscriber → WS broadcast",
  "main": "server.js",
  "type": "commonjs",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "mqtt": "^5.10.0",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 1.2: Write `ws-gateway/Dockerfile`**

```dockerfile
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json /app/package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js /app/server.js

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=10s \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["node", "server.js"]
```

- [ ] **Step 1.3: Write `ws-gateway/README.md`**

```markdown
# EHPAD WebSocket Gateway (Sub-project 5)

Subscribes to MQTT (`ehpad/alerts/#`, `ehpad/state/+`, `ehpad/risk/+`) and broadcasts JSON envelopes to connected `/ws` clients.

## Endpoints

- `GET /health` — 200 once MQTT is connected
- `WS /ws` — upgrade endpoint for WebSocket clients

## Envelope format

```json
{ "topic": "alerts/new", "data": { "id": "abc", ... } }
```

The `topic` field strips the `ehpad/` prefix.

## Configuration

| Variable    | Default               |
| ----------- | --------------------- |
| MQTT_HOST   | mosquitto             |
| MQTT_PORT   | 1883                  |
| WS_PORT     | 8080                  |
```

- [ ] **Step 1.4: Verify layout**

```bash
ls -1 ws-gateway/
```

Expected: `Dockerfile`, `README.md`, `package.json`.

- [ ] **Step 1.5: Commit**

```bash
git add ws-gateway/
git commit -m "feat(ws-gateway): node project skeleton (package.json, Dockerfile, README)"
```

---

## Task 2: server.js implementation

**Files:**
- Create: `ws-gateway/server.js`

No unit tests for this task — Node lacks an existing test setup in this repo, and the gateway logic is small + integration-tested via Docker smoke in Task 3. Spec §8 explicitly accepts a `~100 LOC single file`.

- [ ] **Step 2.1: Write `ws-gateway/server.js`**

```javascript
"use strict";

const http = require("http");
const mqtt = require("mqtt");
const { WebSocketServer } = require("ws");

const MQTT_HOST = process.env.MQTT_HOST || "mosquitto";
const MQTT_PORT = parseInt(process.env.MQTT_PORT || "1883", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "8080", 10);

const SUBSCRIBE_TOPICS = [
  "ehpad/alerts/#",
  "ehpad/state/+",
  "ehpad/risk/+",
];

let mqttConnected = false;

function log(level, msg, extra = {}) {
  const entry = { ts: new Date().toISOString(), level, service: "ws-gateway", msg, ...extra };
  console.log(JSON.stringify(entry));
}

function stripPrefix(topic) {
  return topic.startsWith("ehpad/") ? topic.slice(6) : topic;
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    if (!mqttConnected) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "degraded", mqtt: false }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", mqtt: true, clients: wss.clients.size }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  log("info", "client_connected", { clients: wss.clients.size });
  ws.on("close", () => {
    log("info", "client_disconnected", { clients: wss.clients.size });
  });
  ws.on("error", (err) => {
    log("warn", "client_error", { err: String(err && err.message || err) });
  });
});

function broadcast(envelope) {
  const payload = JSON.stringify(envelope);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      try {
        client.send(payload);
      } catch (err) {
        log("warn", "send_failed", { err: String(err && err.message || err) });
      }
    }
  }
}

const mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
  reconnectPeriod: 2000,
  clientId: `ehpad-ws-gateway-${Math.random().toString(16).slice(2, 10)}`,
});

mqttClient.on("connect", () => {
  mqttConnected = true;
  log("info", "mqtt_connected", { host: MQTT_HOST, port: MQTT_PORT });
  for (const t of SUBSCRIBE_TOPICS) {
    mqttClient.subscribe(t, { qos: 1 }, (err) => {
      if (err) log("error", "subscribe_failed", { topic: t, err: String(err) });
      else log("info", "subscribed", { topic: t });
    });
  }
});

mqttClient.on("reconnect", () => log("info", "mqtt_reconnecting"));
mqttClient.on("close", () => {
  mqttConnected = false;
  log("warn", "mqtt_closed");
});
mqttClient.on("error", (err) => {
  log("error", "mqtt_error", { err: String(err && err.message || err) });
});

mqttClient.on("message", (topic, payloadBuf) => {
  let data;
  try {
    data = JSON.parse(payloadBuf.toString("utf8"));
  } catch (err) {
    log("warn", "invalid_json", { topic, err: String(err && err.message || err) });
    return;
  }
  const envelope = { topic: stripPrefix(topic), data };
  broadcast(envelope);
});

server.listen(WS_PORT, () => {
  log("info", "ws_gateway_listening", { port: WS_PORT, mqtt: `${MQTT_HOST}:${MQTT_PORT}` });
});

function shutdown(signal) {
  log("info", "shutdown", { signal });
  try {
    mqttClient.end(true);
  } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

- [ ] **Step 2.2: Local syntax check (optional, if Node available)**

```bash
node --check ws-gateway/server.js
```

Expected: no output, exit 0.

If Node is not installed locally, skip; the Docker build in Task 3 will fail visibly if there's a syntax error.

- [ ] **Step 2.3: Commit**

```bash
git add ws-gateway/server.js
git commit -m "feat(ws-gateway): mqtt subscriber + ws broadcast server (single file)"
```

---

## Task 3: Backend state publish + compose + smoke + tag

**Files:**
- Modify: `backend/app/ingest/handlers.py` — accept optional publisher; emit `ehpad/state/resident/<id>` after each merge.
- Modify: `backend/app/main.py` — pass `_mqtt` into the dispatch path so handlers can publish.
- Modify: `backend/app/storage/redis.py` — `merge_resident_state` already returns the merged state; we use it directly.
- Modify: `docker-compose.yml` — add `ws-gateway` service; remove the simulator's hard dep on backend if any (it isn't dependent — only mqtt).
- Modify: `README.md` — document ws-gateway endpoint.

- [ ] **Step 3.1: Add state-publish to handlers**

Read `backend/app/ingest/handlers.py`. The current signature is:
```python
async def handle(family: str, key: str, raw: str | bytes, cache: RedisCache, influx: Any) -> None:
```

Modify to accept an optional publisher (positional after influx, default None) and call its `publish` method after each `merge_resident_state`. Final file content:

```python
from __future__ import annotations
import json
from typing import Any
from ..models import VitalsPayload, MotionPayload
from ..storage.redis import RedisCache
from ..logging import get_logger

log = get_logger("backend.ingest")


async def handle(family: str, key: str, raw: str | bytes, cache: RedisCache, influx: Any, publisher: Any | None = None) -> None:
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        log.warning("invalid_json", family=family, key=key)
        return
    try:
        if family == "vitals":
            await _handle_vitals(data, cache, influx, publisher)
        elif family == "motion":
            await _handle_motion(data, cache, influx, publisher)
        # ambient/door deliberately ignored at this stage
    except Exception as exc:  # noqa: BLE001 -- log and recover; ingest must never crash
        log.error("handler_failed", family=family, key=key, err=str(exc))


async def _handle_vitals(data: dict[str, Any], cache: RedisCache, influx: Any, publisher: Any | None) -> None:
    payload = VitalsPayload.model_validate(data)
    merged = await cache.merge_resident_state(payload.resident_id, {
        "last_seen": payload.timestamp,
        "vitals": payload.values.model_dump(),
    })
    await influx.write_vitals(payload.resident_id, payload.timestamp, payload.values.model_dump())
    if publisher is not None:
        try:
            publisher.publish(f"ehpad/state/resident/{payload.resident_id}",
                              json.dumps({"resident_id": payload.resident_id, **merged}),
                              qos=0)
        except Exception as exc:  # noqa: BLE001
            log.warning("state_publish_failed", resident_id=payload.resident_id, err=str(exc))


async def _handle_motion(data: dict[str, Any], cache: RedisCache, influx: Any, publisher: Any | None) -> None:
    payload = MotionPayload.model_validate(data)
    merged = await cache.merge_resident_state(payload.resident_id, {
        "last_seen": payload.timestamp,
        "motion": payload.values.model_dump(),
    })
    await influx.write_motion(payload.resident_id, payload.timestamp, payload.values.model_dump())
    if publisher is not None:
        try:
            publisher.publish(f"ehpad/state/resident/{payload.resident_id}",
                              json.dumps({"resident_id": payload.resident_id, **merged}),
                              qos=0)
        except Exception as exc:  # noqa: BLE001
            log.warning("state_publish_failed", resident_id=payload.resident_id, err=str(exc))
```

The optional positional default `publisher=None` keeps existing tests (which call `handle(family, key, payload, cache, influx)`) working without modification.

- [ ] **Step 3.2: Wire publisher in `main.py`**

Read `backend/app/main.py`. Modify the `_dispatch` coroutine to pass `_mqtt` as the new positional `publisher` argument:

```python
async def _dispatch(family: str, key: str, payload: bytes) -> None:
    assert _cache is not None and _influx is not None
    await h.handle(family, key, payload, _cache, _influx, _mqtt)
```

That's the only change to `main.py`.

- [ ] **Step 3.3: Run tests — should still be 37 passed**

```bash
cd "backend" && source .venv/bin/activate
python3 -m pytest -v 2>&1 | tail -5
```

Expected: 37 passed. The handlers tests don't pass a publisher (default `None`), so the publish path is skipped silently — no regression.

- [ ] **Step 3.4: Add ws-gateway to docker-compose.yml**

Insert AFTER the `backend` service block and BEFORE the `volumes:` section:

```yaml
  ws-gateway:
    build: ./ws-gateway
    container_name: ehpad-ws-gateway
    ports:
      - "8080:8080"
    depends_on:
      mosquitto: { condition: service_healthy }
    environment:
      MQTT_HOST: mosquitto
      MQTT_PORT: 1883
      WS_PORT: 8080
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 10s
```

Validate:
```bash
cd "/Users/drikce/Desktop/projet 2 iot Santé"
docker compose config --quiet
```
Expected: exit 0.

- [ ] **Step 3.5: Bring up + smoke**

```bash
cd "/Users/drikce/Desktop/projet 2 iot Santé"
docker compose up -d --build
sleep 50
docker compose ps
```

Expected: 6 services healthy: mosquitto, redis, influxdb, simulator, backend, ws-gateway.

- [ ] **Step 3.6: Verify health endpoint**

```bash
curl -fsS http://localhost:8080/health | python3 -m json.tool
```

Expected: `{"status":"ok","mqtt":true,"clients":0}` (or N>0 if a client is connected).

- [ ] **Step 3.7: Subscribe via WebSocket and observe alert + state messages**

```bash
# Use a tiny inline Python WS client
python3 - <<'EOF'
import asyncio, json, websockets
async def main():
    async with websockets.connect("ws://localhost:8080/ws") as ws:
        # First, trigger a fall to guarantee an alert
        # (curl runs in the shell before this script)
        for _ in range(15):
            msg = await asyncio.wait_for(ws.recv(), timeout=10)
            env = json.loads(msg)
            print(env["topic"], env.get("data", {}).get("resident_id") or env.get("data", {}).get("id"))
asyncio.run(main())
EOF
```

In a separate shell (or just before, while the python script runs), inject a fall:
```bash
curl -fsS -X POST http://localhost:9100/scenario/R007 \
  -H 'Content-Type: application/json' -d '{"name":"fall"}'
```

Expected: the python WS client prints at least 5 lines mixing `state/resident/R0xx` and (within ~5 s) one or more `alerts/new` or `alerts/update/<id>` lines.

If the script blocks with no output, run `docker compose logs --tail 30 ws-gateway` and report.

- [ ] **Step 3.8: Tear down**

```bash
docker compose down
```

- [ ] **Step 3.9: Update README**

Append the new section AFTER the "Alert Engine (sub-project 4 — landed)" section, BEFORE the `See \`docs/infra-quickstart.md\`` line:

```markdown

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

Subscribed MQTT patterns: `ehpad/alerts/#`, `ehpad/state/+`, `ehpad/risk/+`.
```

- [ ] **Step 3.10: Commit + tag**

```bash
cd "/Users/drikce/Desktop/projet 2 iot Santé"
git add backend/app/ingest/handlers.py backend/app/main.py docker-compose.yml README.md
git commit -m "feat(ws-gateway,backend): publish state to MQTT; add ws-gateway service to compose"
git tag -a ws-gateway-v0.1 -m "WebSocket gateway: MQTT bridge to /ws clients with envelope format"
git tag --list
```

Expected: `ws-gateway-v0.1` tag listed alongside the previous four.

---

## Done Criteria

- 6 compose services healthy.
- `GET http://localhost:8080/health` returns 200 with `mqtt:true`.
- A WebSocket client connected to `ws://localhost:8080/ws` receives at least `state/resident/<id>` envelopes within ~5 s of stack startup.
- A fall scenario produces an `alerts/new` or `alerts/update/<id>` envelope on the WS within ~5 s of injection.
- 37 backend pytest tests still pass (no new tests in this plan; ws-gateway has no unit tests by design).
- Tag `ws-gateway-v0.1` exists.

## Self-Review

Spec coverage: §3 architecture (front never touches MQTT) → ws-gateway is the boundary. §4 alert/state topics → backend now publishes state, ws-gateway subscribes alerts + state + risk. §8 ws-gateway contract (subscribe patterns + envelope format + `/ws` + ~100 LOC single file) → server.js is ~120 LOC, stays well within scope.

Type names consistent: envelope keys `{topic, data}` match spec §8.

No placeholders. All commands include expected output.
