import { Link } from "react-router-dom";
import { Card, CardBody } from "./ui/Card";
import { VitalGauge } from "./VitalGauge";
import { AlertBadge } from "./AlertBadge";
import { fmtRelative } from "@/lib/format";
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
  return (
    <Link to={`/resident/${resident.resident_id}`} className="block">
      <Card className={`ring-2 ${ring} hover:shadow-lg hover:shadow-purple-900/30 transition-shadow`}>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-white">{resident.resident_id}</div>
            {level > 0 && <AlertBadge level={level} />}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <VitalGauge label="FC" value={v?.hr} unit="bpm"
              warn={(x) => x > 100 || x < 55}
              crit={(x) => x > 140 || x < 40} />
            <VitalGauge label="SpO2" value={v?.spo2} unit="%"
              warn={(x) => x < 95}
              crit={(x) => x < 88} />
            <VitalGauge label="T°" value={v?.temp} unit="°C"
              warn={(x) => x < 35.5 || x > 37.8}
              crit={(x) => x < 35 || x > 38.5} />
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>{m?.activity ?? "—"}</span>
            {typeof resident.risk === "number" && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                resident.risk >= 0.6 ? "bg-orange-900/60 text-orange-300"
                : resident.risk >= 0.3 ? "bg-yellow-900/60 text-yellow-300"
                : "bg-zinc-800 text-zinc-300"
              }`}>risque {(resident.risk * 100).toFixed(0)}</span>
            )}
            <span>il y a {fmtRelative(resident.last_seen)}</span>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
