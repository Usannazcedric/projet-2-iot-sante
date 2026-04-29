import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/store/store";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { VitalGauge } from "@/components/VitalGauge";
import { AlertBadge } from "@/components/AlertBadge";
import { AckButton } from "@/components/AckButton";
import { VitalChart } from "@/components/VitalChart";
import { Button } from "@/components/ui/Button";
import { fmtRelative, LEVEL_LABELS, LEVEL_DESCRIPTIONS, ACTIVITY_LABELS, STATUS_BY_LEVEL } from "@/lib/format";
import { highestLevelFor } from "@/store/store";

const SCENARIO_LABELS: Record<string, { label: string; desc: string }> = {
  normal: { label: "Normal", desc: "Rétablir les constantes normales" },
  fall: { label: "Chute", desc: "Simuler une chute détectée" },
  cardiac: { label: "Problème cardiaque", desc: "Simuler une anomalie cardiaque" },
  wandering: { label: "Errance", desc: "Simuler un déplacement inhabituel" },
  degradation: { label: "Dégradation lente", desc: "Simuler une dégradation progressive" },
};

export function ResidentDetail() {
  const { id = "" } = useParams();
  const resident = useStore((s) => s.residents.get(id));
  const allAlerts = useStore((s) => s.alerts);
  const alerts = useStore((s) => Array.from(s.alerts.values()).filter((a) => a.resident_id === id));
  const [rows, setRows] = useState<Array<{ time: string; field: string; value: number }>>([]);
  const [scenarioBusy, setScenarioBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const h = await api.getHistory(id, "vitals", 15);
        if (!cancelled) setRows(h.rows);
      } catch (err) {
        console.error("history_failed", err);
      }
    })();
    const t = setInterval(async () => {
      try {
        const h = await api.getHistory(id, "vitals", 15);
        if (!cancelled) setRows(h.rows);
      } catch { /* ignore */ }
    }, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [id]);

  const inject = async (name: string) => {
    setScenarioBusy(true);
    try { await api.injectScenario(id, name); } finally { setScenarioBusy(false); }
  };

  if (!resident) {
    return (
      <div className="p-8 flex flex-col items-center gap-3 text-zinc-400">
        <div className="h-6 w-6 border-4 border-zinc-700 border-t-purple-500 rounded-full animate-spin" />
        <div>Chargement de {id}…</div>
      </div>
    );
  }

  const v = resident.vitals;
  const m = resident.motion;
  const level = highestLevelFor(id, allAlerts);
  const status = STATUS_BY_LEVEL[level] ?? STATUS_BY_LEVEL[0];
  const activityLabel = m?.activity ? (ACTIVITY_LABELS[m.activity] ?? m.activity) : "—";

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/" className="text-zinc-400 hover:text-white text-sm">
          ← Retour au tableau de bord
        </Link>
        <div className="h-4 w-px bg-zinc-700" />
        <h1 className="text-2xl font-bold text-white">{id}</h1>
        <span className={`text-sm font-medium ${status.cls}`}>{status.text}</span>
        <span className="text-sm text-zinc-500 ml-auto">
          Dernière mesure reçue il y a {fmtRelative(resident.last_seen)}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="font-semibold text-white">Constantes vitales actuelles</div>
            <div className="text-xs text-zinc-500 mt-0.5">Passez la souris sur un indicateur pour voir les valeurs normales</div>
          </CardHeader>
          <CardBody className="grid grid-cols-3 gap-4">
            <VitalGauge
              label="Rythme cardiaque"
              value={v?.hr}
              unit="bpm"
              title="Normal : 55–100 bpm"
              warn={(x) => x > 100 || x < 55}
              crit={(x) => x > 140 || x < 40}
            />
            <VitalGauge
              label="Saturation oxygène"
              value={v?.spo2}
              unit="%"
              title="Normal : ≥ 95%"
              warn={(x) => x < 95}
              crit={(x) => x < 88}
            />
            <VitalGauge
              label="Température"
              value={v?.temp}
              unit="°C"
              title="Normal : 35.5–37.8 °C"
              warn={(x) => x < 35.5 || x > 37.8}
              crit={(x) => x < 35 || x > 38.5}
            />
            <VitalGauge
              label="Tension maximale"
              value={v?.sys}
              unit="mmHg"
              title="Pression artérielle systolique"
            />
            <VitalGauge
              label="Tension minimale"
              value={v?.dia}
              unit="mmHg"
              title="Pression artérielle diastolique"
            />
            <div className="flex flex-col items-start">
              <div className="text-[10px] uppercase tracking-wide text-zinc-400">Activité</div>
              <div className={`text-sm font-semibold mt-1 ${m?.activity === "fall_detected" ? "text-red-400" : "text-white"}`}>
                {activityLabel}
              </div>
            </div>
            {typeof resident.risk === "number" && (
              <div className="col-span-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">
                  Risque de malaise (prédit par IA)
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        resident.risk >= 0.6 ? "bg-orange-500" : resident.risk >= 0.3 ? "bg-yellow-500" : "bg-green-500"
                      }`}
                      style={{ width: `${(resident.risk * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span
                    className={`text-sm font-semibold ${
                      resident.risk >= 0.6 ? "text-orange-400" : resident.risk >= 0.3 ? "text-yellow-400" : "text-green-400"
                    }`}
                    title="Probabilité de malaise dans les 30–60 prochaines minutes"
                  >
                    {(resident.risk * 100).toFixed(0)}%
                  </span>
                  <span className="text-xs text-zinc-500">
                    {resident.risk >= 0.6 ? "Risque élevé" : resident.risk >= 0.3 ? "Risque modéré" : "Risque faible"}
                  </span>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="font-semibold text-white">
              Alertes actives
              {alerts.length > 0 && (
                <span className="ml-2 text-sm font-normal text-zinc-400">({alerts.length})</span>
              )}
            </div>
          </CardHeader>
          <CardBody className="space-y-2">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-zinc-400">
                <div className="text-sm font-medium text-green-400">Aucune alerte active</div>
                <div className="text-xs text-zinc-500">Ce résident ne présente pas d'anomalie détectée.</div>
              </div>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="border border-zinc-800 rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AlertBadge level={a.level} />
                    <div className="flex-1 text-sm">
                      <div className="font-medium text-white">{LEVEL_LABELS[a.level]} — {a.reason}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">{LEVEL_DESCRIPTIONS[a.level]}</div>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {a.status === "active" ? "En attente" : a.status === "acknowledged" ? "Pris en charge" : "Résolu"}
                        {" · "}il y a {fmtRelative(a.created_at)}
                      </div>
                    </div>
                  </div>
                  <AckButton alert={a} />
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="font-semibold text-white">Évolution des constantes — 15 dernières minutes</div>
          <div className="text-xs text-zinc-500 mt-0.5">Rythme cardiaque (bpm), Saturation oxygène (%), Température (°C)</div>
        </CardHeader>
        <CardBody>
          <VitalChart rows={rows} fields={["hr", "spo2", "temp"]} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold text-white">Simulation de scénarios</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Injectez un scénario de démonstration pour tester le système d'alertes.
          </div>
        </CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {Object.entries(SCENARIO_LABELS).map(([name, { label, desc }]) => (
            <button
              key={name}
              disabled={scenarioBusy}
              onClick={() => inject(name)}
              className="text-left p-3 rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              <div className="text-sm font-medium text-white">{label}</div>
              <div className="text-xs text-zinc-400 mt-0.5">{desc}</div>
            </button>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
