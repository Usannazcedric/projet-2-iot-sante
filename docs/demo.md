# Demo Runbook (8 min)

This script walks through what to show during a live demo. Stack must be up with `DEMO_MODE=true` (default in compose), so escalations and the `degradation` scenario unfold within the demo window.

## Prep (before audience joins)

```bash
docker compose down -v       # clean slate (deletes volumes)
docker compose up -d --build # ~60 s for first build
```

Wait for all 7 services healthy:

```bash
until [ "$(docker compose ps --format '{{.State}} {{.Health}}' | grep -c 'running healthy')" = "7" ]; do sleep 3; done
docker compose ps
```

Open `http://localhost:3000` in a full-screen browser tab. You should see 20 resident cards.

Have a second terminal ready with `mosquitto_sub` for visible proof of MQTT activity:

```bash
docker exec ehpad-mosquitto mosquitto_sub -h localhost -t 'ehpad/#' -v
```

## Script

### 1 — Tour (1 min)

> "20 residents. Each card shows live HR / SpO2 / temperature, the dominant activity, and an ML risk score that updates every 30 s. Color rings encode alert level."

Show the live indicator (green dot top right = WebSocket connected). Mention the second terminal: every line you see is an MQTT message between the simulator and the backend.

### 2 — Slow degradation, ML predicts (2 min)

```bash
curl -fsS -X POST http://localhost:3000/sim/scenario/R007 \
  -H 'Content-Type: application/json' -d '{"name":"degradation"}'
```

> "I just told the simulator to start drifting R007's vitals — HR climbing, SpO2 falling. No threshold crossed yet. Watch the risk pill."

Within ~60 s the R007 risk pill turns yellow (≥ 0.30). Around the 90 s mark it goes orange (≥ 0.60), and the alert engine raises an L3 *before* the SpO2 threshold is breached — the ML side caught it first.

> "That's S1 — IsolationForest scoring on a 15-min rolling window plus slope analysis. The model was trained at startup on synthetic baseline data, so this works at minute 0 of the demo."

### 3 — Auto-escalation (1 min)

Don't acknowledge R007. With `DEMO_MODE` on, the unacked L3 escalates to L4 in 30 s.

> "Operator hasn't acked. Engine escalates automatically — L3 → L4 — to surface dropped alerts. Sticky semantics: once raised, only ack/resolve clears it; the engine never silently downgrades."

### 4 — Acute fall (1 min)

```bash
curl -fsS -X POST http://localhost:3000/sim/scenario/R012 \
  -H 'Content-Type: application/json' -d '{"name":"fall"}'
```

The R012 card flashes red (L4) within ~2 s; a toast appears at the top right.

> "Different signal — accelerometer pattern, not vitals. Pure threshold rule, instant detection. Toast comes from the WebSocket envelope, no polling."

### 5 — Drill-down (1 min)

Click the R007 card.

> "All vitals, the active alert with reason, the 15-min trend chart, scenario controls. The Risk gauge shows the same combined score that's on the grid card. The alert engine reads only the cached score from Redis — never recomputes — so a 1-Hz alert loop on a 30-s ML cadence is fine."

Click "Acknowledge" on the active alert. Status flips to `acknowledged`; the auto-escalation timer for it is cancelled.

### 6 — Alert log + audit (1 min)

Click "Alerts" in the nav.

> "Filterable log of every active alert. Resolution removes from this list and writes an audit row to InfluxDB."

Resolve R012's fall alert. Show the audit row:

```bash
docker exec ehpad-influxdb influx query \
  --token ehpad-token-dev --org ehpad \
  'from(bucket:"ehpad_vitals") |> range(start: -10m) |> filter(fn:(r)=>r._measurement=="alerts") |> tail(n:5)'
```

### 7 — Architecture (1 min)

Drop the demo and walk `docs/architecture.md` (the ASCII diagram is enough).

> "Simulator + backend + ws-gateway + frontend, glued by MQTT for events and Redis + Influx for state and history. ML in-process in the backend so we don't pay for a separate container. nginx makes the browser same-origin so no CORS."

Mention the test surface: `pytest -q` runs 59 backend tests in ~2 s.

### 8 — Q&A (1 min)

Common questions and one-liner answers:

- *"What if the WebSocket drops?"* — Exponential backoff up to 5 s, the front shows the offline indicator.
- *"What if Redis falls behind?"* — State has 60 s TTL; the alert engine treats stale residents as "no ML signal" and falls back to threshold rules only.
- *"Production?"* — `DEMO_MODE=false` reverts to real-time escalation cadence (L2→L3 = 10 min). All other paths are unchanged.
- *"Auth?"* — Out of scope for this version (see §13 of the design spec). Same-origin nginx already isolates the SPA from cross-origin requests.

## Cleanup

```bash
docker compose down
```

Models persist on the `models-data` volume; subsequent boots reload them and skip retraining.

## Reset between rehearsals

If you want every run to start "clean" (no leftover acked alerts, no model cache):

```bash
docker compose down -v
docker compose up -d --build
```
