"use strict";

const http = require("http");
const mqtt = require("mqtt");
const { WebSocketServer } = require("ws");

const MQTT_HOST = process.env.MQTT_HOST || "mosquitto";
const MQTT_PORT = parseInt(process.env.MQTT_PORT || "1883", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "8080", 10);

const SUBSCRIBE_TOPICS = [
  "ehpad/alerts/#",
  "ehpad/state/#",
  "ehpad/risk/#",
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
