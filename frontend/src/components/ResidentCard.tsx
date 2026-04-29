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
    0: "ring-slate-200",
    1: "ring-blue-300",
    2: "ring-yellow-400",
    3: "ring-orange-500",
    4: "ring-red-500",
    5: "ring-black",
  };
  const ring = ringByLevel[level] ?? "ring-slate-200";
  return (
    <Link to={`/resident/${resident.resident_id}`} className="block">
      <Card className={`ring-2 ${ring} hover:shadow-md transition-shadow`}>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">{resident.resident_id}</div>
            {level > 0 && <AlertBadge level={level} />}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <VitalGauge label="HR" value={v?.hr} unit="bpm"
              warn={(x) => x > 100 || x < 55}
              crit={(x) => x > 140 || x < 40} />
            <VitalGauge label="SpO2" value={v?.spo2} unit="%"
              warn={(x) => x < 95}
              crit={(x) => x < 88} />
            <VitalGauge label="T°" value={v?.temp} unit="°C"
              warn={(x) => x < 35.5 || x > 37.8}
              crit={(x) => x < 35 || x > 38.5} />
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{m?.activity ?? "—"}</span>
            {typeof resident.risk === "number" && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                resident.risk >= 0.6 ? "bg-orange-100 text-orange-700"
                : resident.risk >= 0.3 ? "bg-yellow-100 text-yellow-800"
                : "bg-slate-100 text-slate-600"
              }`}>risk {(resident.risk * 100).toFixed(0)}</span>
            )}
            <span>{fmtRelative(resident.last_seen)} ago</span>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
