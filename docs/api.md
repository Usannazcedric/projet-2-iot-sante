# API Reference

All endpoints below are reachable through the nginx-proxied origin at `http://localhost:3000` (browser) and through their direct ports (CLI / debug). For the architecture see `docs/architecture.md`.

## Backend REST (port 8000, proxied at `/api`)

### `GET /health`

Liveness + dependency readiness.

```bash
curl -fsS http://localhost:8000/health
# → {"status":"ok","redis":true,"influx":true,"mqtt":true}
```

200 only when Redis, Influx, and MQTT are all connected.

### `GET /residents`

List the latest snapshot per resident.

```bash
curl -fsS http://localhost:8000/residents
```

Response: array of `ResidentSnapshot`:

```jsonc
{
  "resident_id": "R007",
  "last_seen": "2026-04-29T20:00:00.123+00:00",
  "vitals": { "hr": 78, "spo2": 97, "sys": 122, "dia": 80, "temp": 36.7 },
  "motion": { "ax": 0.01, "ay": -0.02, "az": 9.81, "activity": "rest" },
  "risk": 0.31
}
```

Empty fields (`vitals`, `motion`, `risk`) are absent until the corresponding source publishes.

### `GET /residents/{id}`

Single snapshot. 404 if no state in Redis (TTL 60 s).

### `GET /residents/{id}/history`

Influx-backed time-series.

Query parameters:

| Name      | Type   | Required | Default | Notes                        |
| --------- | ------ | -------- | ------- | ---------------------------- |
| `metric`  | string | yes      | —       | One of `vitals`, `motion`    |
| `minutes` | int    | no       | `15`    | Window in minutes back from now |

```bash
curl -fsS "http://localhost:8000/residents/R007/history?metric=vitals&minutes=15"
```

Response:

```jsonc
{
  "resident_id": "R007",
  "metric": "vitals",
  "rows": [
    { "time": "2026-04-29T19:45:00Z", "field": "hr", "value": 78 },
    { "time": "2026-04-29T19:45:00Z", "field": "spo2", "value": 97 },
    ...
  ]
}
```

### `GET /alerts`

Active alerts (status `active` or `acknowledged`). Resolved alerts are excluded.

```bash
curl -fsS http://localhost:8000/alerts
```

Element shape (`Alert`):

```jsonc
{
  "id": "8f3c0d2b-...",
  "resident_id": "R007",
  "level": 4,
  "reason": "fall pattern",
  "status": "active",
  "created_at": "2026-04-29T19:50:01Z",
  "updated_at": "2026-04-29T19:50:01Z",
  "last_seen": "2026-04-29T19:55:30Z"
}
```

### `POST /alerts/{id}/ack`

Acknowledge. Cancels the escalation timer; status becomes `acknowledged`. Returns the updated alert.

### `POST /alerts/{id}/resolve`

Resolve. Removes from the active set and audits to Influx. Returns the updated alert.

## Simulator REST (port 9100, proxied at `/sim`)

### `GET /health`

```bash
curl -fsS http://localhost:9100/health
# → {"status":"ok","residents":20}
```

### `GET /residents`

Resident metadata (id, name, room, profile). Does not include live vitals — those are on the backend.

### `POST /scenario/{id}`

Body:

```json
{ "name": "fall" | "cardiac" | "wandering" | "degradation" | "normal" }
```

Triggers the named scenario for that resident; the simulator overrides its baseline pattern for the scenario duration.

```bash
curl -fsS -X POST http://localhost:9100/scenario/R007 \
  -H 'Content-Type: application/json' -d '{"name":"fall"}'
# → {"resident_id":"R007","scenario":"fall"}
```

Compressed timing under `DEMO_MODE=true`.

## ws-gateway WebSocket (port 8080, proxied at `/ws`)

```js
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
ws.onmessage = (e) => {
  const env = JSON.parse(e.data);   // { topic, data }
};
```

Envelope shape: `{ topic: string, data: object }`. The `topic` strips the `ehpad/` prefix.

### Topic catalogue

| Topic                          | When                              | `data` shape                                  |
| ------------------------------ | --------------------------------- | --------------------------------------------- |
| `state/resident/<id>`          | Each vitals or motion ingest       | merged `ResidentSnapshot`                     |
| `alerts/new`                   | Alert engine creates an alert      | `Alert`                                       |
| `alerts/update/<id>`           | Status or level change             | `Alert`                                       |
| `risk/resident/<id>`           | Every 30 s per resident            | `{ resident_id, anomaly, trend, combined, risk, timestamp }` |

WS server is publish-only — clients ignore inbound from clients. Reconnect on close (front-end uses exponential backoff capped at 5 s, see `frontend/src/lib/ws.ts`).

## MQTT topic schema (broker port 1883)

| Topic                          | Payload                                                | Publisher  | QoS |
| ------------------------------ | ------------------------------------------------------ | ---------- | --- |
| `ehpad/vitals/resident/<id>`   | `{ resident_id, timestamp, values: VitalsValues }`     | simulator  | 0   |
| `ehpad/motion/resident/<id>`   | `{ resident_id, timestamp, values: MotionValues }`     | simulator  | 0   |
| `ehpad/state/resident/<id>`    | `{ resident_id, vitals?, motion?, risk?, last_seen }`  | backend    | 0   |
| `ehpad/alerts/new`             | `Alert`                                                | backend    | 1   |
| `ehpad/alerts/update/<id>`     | `Alert`                                                | backend    | 1   |
| `ehpad/risk/resident/<id>`     | `{ resident_id, anomaly, trend, combined, risk, ts }`  | backend    | 0   |

`VitalsValues`: `{ hr, spo2, sys, dia, temp }`.
`MotionValues`: `{ ax, ay, az, activity }`.

## Alert level matrix

| Level | Label          | Color  | Trigger (examples)                                                         |
| ----- | -------------- | ------ | -------------------------------------------------------------------------- |
| 1     | Information    | Blue   | New alert seed (rare in v1; mostly internal)                               |
| 2     | Attention      | Yellow | HR > 100 sustained, SpO2 borderline (88–94%), temp deviation               |
| 3     | Alerte         | Orange | SpO2 < 93% sustained, no motion 1 h, ML risk > 0.6                         |
| 4     | Urgence        | Red    | Fall pattern, critical HR / SpO2, escalated unacked L3                     |
| 5     | Danger vital   | Black  | Critical vitals + immobile, escalated unacked L4                           |

Auto-escalation cadence (`PROD_DELAYS`): L2→L3 in 10 min, L3→L4 in 5 min, L4→L5 in 3 min. `DEMO_MODE` divides each by 10.

## Error codes

REST endpoints return standard HTTP codes. The body for non-2xx responses is `{ "detail": string }` (FastAPI default).

| Code | Endpoint family   | Cause                                            |
| ---- | ----------------- | ------------------------------------------------ |
| 200  | All               | Success                                          |
| 404  | `/residents/{id}` | No live state for the id (TTL expired)           |
| 404  | `/alerts/{id}/...`| Alert id not in active set                       |
| 422  | All POSTs         | Body fails validation                            |
| 503  | `/health`         | Redis / Influx / MQTT unreachable                |

WebSocket uses standard close codes; reconnect handles transient.
