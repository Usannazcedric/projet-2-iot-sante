import { useStore } from "@/store/store";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { AlertBadge } from "@/components/AlertBadge";
import { AckButton } from "@/components/AckButton";
import { fmtRelative, LEVEL_LABELS, LEVEL_DESCRIPTIONS } from "@/lib/format";
import { Link } from "react-router-dom";
import { useState, useMemo } from "react";

const STATUS_DISPLAY: Record<string, { label: string; cls: string }> = {
  active: { label: "En attente de prise en charge", cls: "text-orange-400" },
  acknowledged: { label: "Pris en charge", cls: "text-blue-400" },
  resolved: { label: "Résolu", cls: "text-green-400" },
};

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
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-400 flex gap-4 items-start">
        <div className="flex-1 space-y-1">
          <div className="font-semibold text-zinc-300 mb-2">Comment gérer une alerte ?</div>
          <div>
            <span className="font-medium text-zinc-300">Je prends en charge</span>
            {" "}→ vous avez vu l'alerte et vous vous en occupez. Elle reste visible.
          </div>
          <div>
            <span className="font-medium text-zinc-300">Résolu</span>
            {" "}→ la situation est réglée. L'alerte est fermée.
          </div>
        </div>
        <div className="hidden md:block border-l border-zinc-700 pl-4 flex-1 space-y-1">
          <div className="font-semibold text-zinc-300 mb-2">Niveaux d'alerte</div>
          {([1, 2, 3, 4, 5] as const).map((l) => (
            <div key={l} className="flex items-start gap-2">
              <AlertBadge level={l} />
              <span className="text-xs text-zinc-500">{LEVEL_DESCRIPTIONS[l]}</span>
            </div>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="font-semibold text-white">
              Alertes en cours
              {filtered.length > 0 && (
                <span className="ml-2 text-sm font-normal text-zinc-400">({filtered.length})</span>
              )}
            </div>
            <select
              value={levelFilter === "" ? "" : String(levelFilter)}
              onChange={(e) => setLevelFilter(e.target.value === "" ? "" : Number(e.target.value))}
              className="ml-auto text-sm bg-zinc-800 text-white border border-zinc-700 rounded-md px-2 py-1"
            >
              <option value="">Tous les niveaux</option>
              {([1, 2, 3, 4, 5] as const).map((l) => (
                <option key={l} value={l}>Niveau {l} — {LEVEL_LABELS[l]}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-zinc-400">
              <div className="h-12 w-12 rounded-full border-2 border-green-700 flex items-center justify-center">
                <div className="h-5 w-5 border-b-2 border-r-2 border-green-500 rotate-45 translate-y-[-2px]" />
              </div>
              <div className="text-base font-medium text-zinc-300">Aucune alerte active</div>
              <div className="text-sm text-center max-w-xs">
                Tous les résidents sont surveillés normalement.
                {typeof levelFilter === "number" && " (filtre actif — essayez \"Tous les niveaux\")"}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((a) => {
                const statusDisplay = STATUS_DISPLAY[a.status] ?? { label: a.status, cls: "text-zinc-400" };
                return (
                  <div key={a.id} className="flex items-start gap-3 border border-zinc-800 rounded-md p-3">
                    <div className="mt-0.5">
                      <AlertBadge level={a.level} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={`/resident/${a.resident_id}`}
                          className="font-medium text-sm text-white hover:underline"
                        >
                          {a.resident_id}
                        </Link>
                        <span className="text-sm text-zinc-300">{a.reason}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        <span className={statusDisplay.cls}>{statusDisplay.label}</span>
                        <span className="text-zinc-500">il y a {fmtRelative(a.created_at)}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <AckButton alert={a} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
