# EHPAD Backend (Sub-project 3)

MQTT ingest + Redis state cache + InfluxDB history + read-only REST API.

## REST endpoints

- `GET /health` — 200 once Redis + Influx + MQTT connected
- `GET /residents` — list of last-state snapshots
- `GET /residents/{id}` — single resident snapshot
- `GET /residents/{id}/history?from=&to=&metric=` — Influx Flux query

## Configuration

| Variable        | Default               |
| --------------- | --------------------- |
| MQTT_HOST       | mosquitto             |
| MQTT_PORT       | 1883                  |
| REDIS_URL       | redis://redis:6379    |
| INFLUX_URL      | http://influxdb:8086  |
| INFLUX_TOKEN    | ehpad-token-dev       |
| INFLUX_ORG      | ehpad                 |
| INFLUX_BUCKET   | ehpad_vitals          |
| API_PORT        | 8000                  |
| LOG_LEVEL       | INFO                  |
