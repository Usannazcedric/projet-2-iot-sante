export type Envelope = { topic: string; data: any };

export function createWebSocket(onEnvelope: (env: Envelope) => void, onConnected: (ok: boolean) => void): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let backoff = 500;

  const connect = () => {
    if (closed) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws.addEventListener("open", () => {
      onConnected(true);
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
      onConnected(false);
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
    try { ws?.close(); } catch { /* ignore */ }
  };
}
