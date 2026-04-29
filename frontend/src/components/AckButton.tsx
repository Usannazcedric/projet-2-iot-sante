import { useState } from "react";
import { Button } from "./ui/Button";
import { api, type Alert } from "@/lib/api";
import { useStore } from "@/store/store";

export function AckButton({ alert }: { alert: Alert }) {
  const upsertAlert = useStore((s) => s.upsertAlert);
  const [busy, setBusy] = useState(false);

  const onAck = async () => {
    setBusy(true);
    try {
      const updated = await api.ackAlert(alert.id);
      upsertAlert(updated);
    } catch (err) {
      console.error("ack_failed", err);
    } finally {
      setBusy(false);
    }
  };

  const onResolve = async () => {
    setBusy(true);
    try {
      const updated = await api.resolveAlert(alert.id);
      upsertAlert(updated);
    } catch (err) {
      console.error("resolve_failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-2">
      {alert.status === "active" && (
        <Button
          variant="primary"
          disabled={busy}
          onClick={onAck}
          title="Je prends en charge cette alerte — je m'en occupe"
        >
          Je prends en charge
        </Button>
      )}
      <Button
        variant="secondary"
        disabled={busy}
        onClick={onResolve}
        title="La situation est réglée — fermer cette alerte"
      >
        Résolu
      </Button>
    </div>
  );
}
