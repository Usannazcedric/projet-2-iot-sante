import { useEffect, useState } from "react";
import { api, type StaffMember, type Alert } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useStore } from "@/store/store";
import { LEVEL_LABELS } from "@/lib/format";

const WING_LABEL: Record<string, string> = {
  A: "Aile A (chambres 101–110)",
  B: "Aile B (chambres 111–120)",
  toutes: "Toutes ailes",
};

const SHIFT_LABEL: Record<string, string> = {
  matin: "Matin (7h–15h)",
  "après-midi": "Après-midi (15h–23h)",
  nuit: "Nuit (23h–7h)",
};

const ROLE_ICON: Record<string, string> = {
  "Infirmière": "🩺",
  "Infirmier": "🩺",
  "Aide-soignante": "👩‍⚕️",
  "Aide-soignant": "👨‍⚕️",
  "Médecin coordinateur": "👨‍⚕️",
  "Cadre de santé": "📋",
};

export function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const alerts = useStore((s) => Array.from(s.alerts.values()));

  useEffect(() => {
    api.listStaff()
      .then(setStaff)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const byStaff = (name: string): Alert[] =>
    alerts.filter((a) => a.acknowledged_by === name);

  const onDuty = staff.filter((s) => s.on_duty);
  const offDuty = staff.filter((s) => !s.on_duty);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Gestion du personnel</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Équipe soignante, affectations par aile et alertes prises en charge.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-zinc-400 py-8">
          <div className="h-5 w-5 border-4 border-zinc-700 border-t-purple-500 rounded-full animate-spin" />
          <span>Chargement…</span>
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <div className="font-semibold text-white">Personnel en service</div>
                <span className="text-sm text-zinc-400">({onDuty.length} soignants)</span>
              </div>
            </CardHeader>
            <CardBody className="divide-y divide-zinc-800">
              {onDuty.map((s) => (
                <StaffRow key={s.id} member={s} handledAlerts={byStaff(s.name)} />
              ))}
              {onDuty.length === 0 && (
                <div className="text-zinc-400 text-sm py-3">Aucun soignant en service actuellement.</div>
              )}
            </CardBody>
          </Card>

          {offDuty.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-zinc-600" />
                  <div className="font-semibold text-zinc-400">Personnel hors service</div>
                  <span className="text-sm text-zinc-500">({offDuty.length})</span>
                </div>
              </CardHeader>
              <CardBody className="divide-y divide-zinc-800">
                {offDuty.map((s) => (
                  <StaffRow key={s.id} member={s} handledAlerts={byStaff(s.name)} dim />
                ))}
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StaffRow({
  member, handledAlerts, dim = false,
}: {
  member: StaffMember;
  handledAlerts: Alert[];
  dim?: boolean;
}) {
  const icon = ROLE_ICON[member.role] ?? "👤";
  return (
    <div className={`flex items-start gap-3 py-3 ${dim ? "opacity-50" : ""}`}>
      <div className="flex-shrink-0 h-9 w-9 rounded-full bg-zinc-800 flex items-center justify-center text-lg">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-white text-sm">{member.name}</span>
          <span className="text-xs text-zinc-500">{member.role}</span>
        </div>
        <div className="text-xs text-zinc-500 mt-0.5">
          {WING_LABEL[member.wing] ?? member.wing} · {SHIFT_LABEL[member.shift] ?? member.shift}
        </div>
        {handledAlerts.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {handledAlerts.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300"
              >
                <span className="font-semibold">{a.resident_id}</span>
                <span className="text-zinc-500">{LEVEL_LABELS[a.level]}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 text-right">
        {handledAlerts.length > 0 ? (
          <span className="text-xs text-purple-400 font-medium">{handledAlerts.length} alerte{handledAlerts.length > 1 ? "s" : ""}</span>
        ) : (
          <span className="text-xs text-zinc-600">—</span>
        )}
      </div>
    </div>
  );
}
