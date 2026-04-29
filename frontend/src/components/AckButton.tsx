import { useState } from "react";
import { Button } from "./ui/Button";
import { api, type Alert } from "@/lib/api";
import { useStore } from "@/store/store";

const STAFF_NAMES = [
  "Sophie Martin", "Pierre Dubois", "Nathalie Bernard", "Thomas Leroy",
  "Marie Lambert", "François Moreau", "Claire Fontaine", "Laurent Girard",
  "Dr. Isabelle Dupont", "Élise Rousseau",
];

export function AckButton({ alert }: { alert: Alert }) {
  const upsertAlert = useStore((s) => s.upsertAlert);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState("");

  const onAckClick = () => {
    if (picking) return;
    setPicking(true);
  };

  const confirmAck = async () => {
    setBusy(true);
    try {
      const updated = await api.ackAlert(alert.id, selectedStaff || undefined);
      upsertAlert(updated);
      setPicking(false);
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
    <div className="space-y-2">
      {alert.status === "active" && !picking && (
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={busy}
            onClick={onAckClick}
            title="Je prends en charge cette alerte"
          >
            Je prends en charge
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onResolve} title="La situation est réglée">
            Résolu
          </Button>
        </div>
      )}
      {alert.status === "active" && picking && (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedStaff}
            onChange={(e) => setSelectedStaff(e.target.value)}
            className="flex-1 min-w-32 rounded-md border border-zinc-700 bg-zinc-900 text-white text-sm px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            <option value="">— Sélectionner le soignant —</option>
            {STAFF_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <Button variant="primary" disabled={busy || !selectedStaff} onClick={confirmAck}>
            Confirmer
          </Button>
          <button
            onClick={() => setPicking(false)}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
          >
            Annuler
          </button>
        </div>
      )}
      {alert.status !== "active" && (
        <div className="flex items-center gap-3 flex-wrap">
          {alert.acknowledged_by && (
            <span className="text-xs text-zinc-400">
              Pris en charge par <span className="text-white font-medium">{alert.acknowledged_by}</span>
            </span>
          )}
          <Button variant="secondary" disabled={busy} onClick={onResolve} title="La situation est réglée">
            Résolu
          </Button>
        </div>
      )}
    </div>
  );
}
