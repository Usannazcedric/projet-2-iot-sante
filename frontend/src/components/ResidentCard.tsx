import { Link } from "react-router-dom";
import { Card, CardBody } from "./ui/Card";
import { VitalGauge } from "./VitalGauge";
import { AlertBadge } from "./AlertBadge";
import { fmtRelative, ACTIVITY_LABELS, STATUS_BY_LEVEL } from "@/lib/format";
import type { ResidentSnapshot } from "@/lib/api";

interface Props {
  resident: ResidentSnapshot;
  level: number;
}

export function ResidentCard({ resident, level }: Props) {
  const v = resident.vitals;
  const m = resident.motion;

  const ringByLevel: Record<number, string> = {
    0: "ring-zinc-800",
    1: "ring-blue-500",
    2: "ring-yellow-400",
    3: "ring-orange-500",
    4: "ring-red-500",
    5: "ring-white",
  };
  const ring = ringByLevel[level] ?? "ring-zinc-800";
  const status = STATUS_BY_LEVEL[level] ?? STATUS_BY_LEVEL[0];
  const activityLabel = m?.activity ? (ACTIVITY_LABELS[m.activity] ?? m.activity) : "—";
  const isFall = m?.activity === "fall_detected";

  return (
    <Link to={`/resident/${resident.resident_id}`} className="block" title="Cliquer pour voir les détails de ce résident">
      <Card className={`ring-2 ${ring} hover:shadow-lg hover:shadow-purple-900/30 transition-shadow`}>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-white">{resident.resident_id}</div>
              <div className={`text-xs mt-0.5 ${status.cls}`}>{status.text}</div>
            </div>
            {level > 0 && <AlertBadge level={level} />}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <VitalGauge
              label="Cœur"
              value={v?.hr}
              unit="bpm"
              title="Rythme cardiaque — Normal : 55–100 bpm"
              warn={(x) => x > 100 || x < 55}
              crit={(x) => x > 140 || x < 40}
            />
            <VitalGauge
              label="Oxygène"
              value={v?.spo2}
              unit="%"
              title="Saturation en oxygène — Normal : ≥ 95%"
              warn={(x) => x < 95}
              crit={(x) => x < 88}
            />
            <VitalGauge
              label="Temp."
              value={v?.temp}
              unit="°C"
              title="Température corporelle — Normal : 35.5–37.8 °C"
              warn={(x) => x < 35.5 || x > 37.8}
              crit={(x) => x < 35 || x > 38.5}
            />
          </div>

          <div className="flex items-center justify-between text-xs border-t border-zinc-800 pt-2 gap-1">
            <span
              className={`truncate ${isFall ? "text-red-400 font-semibold" : "text-zinc-400"}`}
              title="Activité détectée par le capteur de mouvement"
            >
              {activityLabel}
            </span>
            {typeof resident.risk === "number" && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                  resident.risk >= 0.6
                    ? "bg-orange-900/60 text-orange-300"
                    : resident.risk >= 0.3
                    ? "bg-yellow-900/60 text-yellow-300"
                    : "bg-zinc-800 text-zinc-300"
                }`}
                title="Probabilité de malaise dans les 30–60 prochaines minutes (calculée par IA)"
              >
                Risque {(resident.risk * 100).toFixed(0)}%
              </span>
            )}
            <span className="text-zinc-500 whitespace-nowrap" title="Dernière mesure reçue">
              {fmtRelative(resident.last_seen)}
            </span>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
