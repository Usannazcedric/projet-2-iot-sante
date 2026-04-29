# EHPAD Simulator

Publishes synthetic resident sensor data over MQTT for the EHPAD monitoring stack.

## Topics

- `ehpad/vitals/resident/<id>` — vitals at 1 Hz
- `ehpad/motion/resident/<id>` — accelerometer + activity at 5 Hz
- `ehpad/ambient/room/<room>` — PIR motion events
- `ehpad/door/room/<room>` — door open/close events

## REST endpoints

- `GET /health` — 200 once MQTT connected
- `GET /residents` — list of profiles
- `POST /scenario/{resident_id}` — body `{ "name": "fall|cardiac|degradation|wandering|normal" }`

## Configuration

Env vars (with defaults):

| Variable        | Default    |
| --------------- | ---------- |
| MQTT_HOST       | mosquitto  |
| MQTT_PORT       | 1883       |
| API_PORT        | 9100       |
| RESIDENT_COUNT  | 20         |
| DEMO_MODE       | false      |
| LOG_LEVEL       | INFO       |

`DEMO_MODE=true` compresses scenario timings (`degradation` 30 min → ~3 min).
