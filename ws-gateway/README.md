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
