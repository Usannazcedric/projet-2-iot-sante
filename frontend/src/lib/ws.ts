export type Envelope = { topic: string; data: any };

const DISCONNECT_GRACE_MS = 2500;

export function createWebSocket(onEnvelope: (env: Envelope) => void, onConnected: (ok: boolean) => void): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let backoff = 500;
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastReported: boolean | null = null;

  const report = (ok: boolean) => {
    if (lastReported === ok) return;
    lastReported = ok;
    onConnected(ok);
  };

  const reportConnected = () => {
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
    report(true);
  };

  const reportDisconnectedSoon = () => {
    if (disconnectTimer || closed) {
      if (closed) report(false);
      return;
    }
    disconnectTimer = setTimeout(() => {
      disconnectTimer = null;
      report(false);
    }, DISCONNECT_GRACE_MS);
  };

  const connect = () => {
    if (closed) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws.addEventListener("open", () => {
      reportConnected();
      backoff = 500;
    });
    ws.addEventListener("message", (ev) => {
      try {
        const env = JSON.parse(ev.data) as Envelope;
        onEnvelope(env);
      } catch {
        /* ignore */
      }
    });
    ws.addEventListener("close", () => {
      reportDisconnectedSoon();
      if (closed) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 5000);
    });
    ws.addEventListener("error", () => {
      try { ws?.close(); } catch { /* ignore */ }
    });
  };

  connect();

  return () => {
    closed = true;
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
    try { ws?.close(); } catch { /* ignore */ }
  };
}
