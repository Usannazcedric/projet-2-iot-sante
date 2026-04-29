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
import { fmtRelative, LEVEL_LABELS } from "@/lib/format";

export function ResidentDetail() {
  const { id = "" } = useParams();
  const resident = useStore((s) => s.residents.get(id));
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

  if (!resident) return <div className="p-8 text-zinc-400">Chargement {id}…</div>;
  const v = resident.vitals;
  const m = resident.motion;

  const scenarioLabels: Record<string, string> = {
    normal: "Normal",
    fall: "Chute",
    cardiac: "Cardiaque",
    wandering: "Errance",
    degradation: "Dégradation",
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-zinc-400 hover:text-white text-sm">← Retour</Link>
        <h1 className="text-2xl font-bold text-white">{id}</h1>
        <span className="text-sm text-zinc-400">dernière mesure il y a {fmtRelative(resident.last_seen)}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="font-semibold text-white">Constantes actuelles</div>
          </CardHeader>
          <CardBody className="grid grid-cols-3 gap-3">
            <VitalGauge label="FC" value={v?.hr} unit="bpm" warn={(x) => x > 100 || x < 55} crit={(x) => x > 140 || x < 40} />
            <VitalGauge label="SpO2" value={v?.spo2} unit="%" warn={(x) => x < 95} crit={(x) => x < 88} />
            <VitalGauge label="T°" value={v?.temp} unit="°C" warn={(x) => x < 35.5 || x > 37.8} crit={(x) => x < 35 || x > 38.5} />
            <VitalGauge label="Sys" value={v?.sys} unit="mmHg" />
            <VitalGauge label="Dia" value={v?.dia} unit="mmHg" />
            <VitalGauge label="Activité" value={undefined} unit={m?.activity ?? "—"} />
            <VitalGauge label="Risque" value={typeof resident.risk === "number" ? Math.round(resident.risk * 100) : null} unit="%"
              warn={(x) => x >= 30}
              crit={(x) => x >= 60} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="font-semibold text-white">Alertes actives</div>
          </CardHeader>
          <CardBody className="space-y-2">
            {alerts.length === 0 ? (
              <div className="text-zinc-400 text-sm">Aucune.</div>
            ) : alerts.map((a) => (
              <div key={a.id} className="border border-zinc-800 rounded-md p-3 flex items-center gap-3">
                <AlertBadge level={a.level} />
                <div className="flex-1 text-sm">
                  <div className="font-medium text-white">{LEVEL_LABELS[a.level]} — {a.reason}</div>
                  <div className="text-xs text-zinc-400">{a.status} · il y a {fmtRelative(a.created_at)}</div>
                </div>
                <AckButton alert={a} />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="font-semibold text-white">Constantes — 15 dernières min</div>
        </CardHeader>
        <CardBody>
          <VitalChart rows={rows} fields={["hr", "spo2", "temp"]} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="font-semibold text-white">Démo — injecter un scénario</div>
        </CardHeader>
        <CardBody className="flex gap-2 flex-wrap">
          {["normal", "fall", "cardiac", "wandering", "degradation"].map((n) => (
            <Button key={n} variant="secondary" disabled={scenarioBusy} onClick={() => inject(n)}>{scenarioLabels[n] ?? n}</Button>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
