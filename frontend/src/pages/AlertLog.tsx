import { useStore } from "@/store/store";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { AlertBadge } from "@/components/AlertBadge";
import { AckButton } from "@/components/AckButton";
import { fmtRelative, LEVEL_LABELS } from "@/lib/format";
import { Link } from "react-router-dom";
import { useState, useMemo } from "react";

export function AlertLog() {
  const alerts = useStore((s) => Array.from(s.alerts.values()));
  const [levelFilter, setLevelFilter] = useState<number | "">("");

  const filtered = useMemo(() => {
    let list = alerts;
    if (typeof levelFilter === "number") list = list.filter((a) => a.level === levelFilter);
    list = list.slice().sort((a, b) => b.level - a.level || b.created_at.localeCompare(a.created_at));
    return list;
  }, [alerts, levelFilter]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="font-semibold text-white">Alertes actives</div>
            <select
              value={levelFilter === "" ? "" : String(levelFilter)}
              onChange={(e) => setLevelFilter(e.target.value === "" ? "" : Number(e.target.value))}
              className="ml-auto text-sm bg-zinc-800 text-white border border-zinc-700 rounded-md px-2 py-1"
            >
              <option value="">Tous niveaux</option>
              {[1, 2, 3, 4, 5].map((l) => (
                <option key={l} value={l}>L{l} {LEVEL_LABELS[l]}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <div className="text-zinc-400 text-sm">Aucune alerte active.</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((a) => (
                <div key={a.id} className="flex items-center gap-3 border border-zinc-800 rounded-md p-3">
                  <AlertBadge level={a.level} />
                  <Link to={`/resident/${a.resident_id}`} className="font-mono text-sm text-white hover:underline">
                    {a.resident_id}
                  </Link>
                  <div className="flex-1 text-sm text-zinc-200">{a.reason}</div>
                  <div className="text-xs text-zinc-400">{a.status} · il y a {fmtRelative(a.created_at)}</div>
                  <AckButton alert={a} />
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
