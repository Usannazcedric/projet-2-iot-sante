import { useEffect, useState } from "react";
import { api, type StaffMember, type Alert } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useStore } from "@/store/store";
import { LEVEL_LABELS } from "@/lib/format";

const WING_LABEL: Record<string, string> = {
  A: "Aile A — chambres 101 à 110",
  B: "Aile B — chambres 111 à 120",
  toutes: "Toutes ailes",
};
const SHIFT_LABEL: Record<string, string> = {
  matin: "Matin (7h–15h)",
  "après-midi": "Après-midi (15h–23h)",
  nuit: "Nuit (23h–7h)",
};

export function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingGuard, setSettingGuard] = useState<string | null>(null);

  const guards = useStore((s) => s.guards);
  const setGuard = useStore((s) => s.setGuard);
  const alerts = useStore((s) => Array.from(s.alerts.values()));

  const reload = () => {
    api.listStaff()
      .then(setStaff)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const assignGuard = async (wing: string, name: string) => {
    setSettingGuard(name);
    try {
      await api.setGuard(wing, name);
      setGuard(wing, name);
      reload();
    } catch (err) {
      console.error("set_guard_failed", err);
    } finally {
      setSettingGuard(null);
    }
  };

  const handledBy = (name: string): Alert[] =>
    alerts.filter((a) => a.acknowledged_by === name);

  const onDuty = staff.filter((s) => s.on_duty);
  const offDuty = staff.filter((s) => !s.on_duty);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Gestion du personnel</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Équipe soignante, soignants de garde par aile, et alertes prises en charge.
        </p>
      </div>

      {/* Guard summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {["A", "B"].map((wing) => (
          <Card key={wing}>
            <CardBody className="flex items-center gap-3">
              <div className="flex-shrink-0 h-10 w-10 rounded-full bg-purple-900 flex items-center justify-center text-lg font-bold text-purple-300">
                {wing}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Soignant de garde — {WING_LABEL[wing]}
                </div>
                <div className="text-sm font-semibold text-white mt-0.5">
                  {guards[wing] ?? "—"}
                </div>
              </div>
              <div className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" title="En poste" />
            </CardBody>
          </Card>
        ))}
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
                <span className="text-sm text-zinc-400">({onDuty.length})</span>
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Cliquez sur "Nommer de garde" pour assigner le soignant responsable d'une aile.
              </div>
            </CardHeader>
            <CardBody className="divide-y divide-zinc-800">
              {onDuty.map((s) => (
                <StaffRow
                  key={s.id}
                  member={s}
                  handledAlerts={handledBy(s.name)}
                  guards={guards}
                  onAssignGuard={assignGuard}
                  busy={settingGuard === s.name}
                />
              ))}
            </CardBody>
          </Card>

          {offDuty.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-zinc-600" />
                  <div className="font-semibold text-zinc-400">Hors service</div>
                  <span className="text-sm text-zinc-500">({offDuty.length})</span>
                </div>
              </CardHeader>
              <CardBody className="divide-y divide-zinc-800">
                {offDuty.map((s) => (
                  <StaffRow
                    key={s.id}
                    member={s}
                    handledAlerts={handledBy(s.name)}
                    guards={guards}
                    onAssignGuard={assignGuard}
                    busy={settingGuard === s.name}
                    dim
                  />
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
  member, handledAlerts, guards, onAssignGuard, busy, dim = false,
}: {
  member: StaffMember;
  handledAlerts: Alert[];
  guards: Record<string, string>;
  onAssignGuard: (wing: string, name: string) => void;
  busy: boolean;
  dim?: boolean;
}) {
  const isGuardA = guards["A"] === member.name;
  const isGuardB = guards["B"] === member.name;
  const isGuard = isGuardA || isGuardB;
  const guardWing = isGuardA ? "A" : isGuardB ? "B" : null;

  // Assignable wings for this staff member
  const assignableWings = member.wing === "toutes"
    ? ["A", "B"]
    : member.wing !== "toutes" ? [member.wing] : [];

  return (
    <div className={`flex items-start gap-3 py-3 ${dim ? "opacity-50" : ""}`}>
      <div className="flex-shrink-0 h-9 w-9 rounded-full bg-zinc-800 flex items-center justify-center text-base">
        {member.role.includes("Médecin") ? "👨‍⚕️" : member.role.includes("Cadre") ? "📋" : "🩺"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-white text-sm">{member.name}</span>
          <span className="text-xs text-zinc-500">{member.role}</span>
          {isGuard && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-900 border border-purple-700 text-purple-300 font-medium">
              🛡 Garde Aile {guardWing}
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-500 mt-0.5">
          {WING_LABEL[member.wing] ?? member.wing} · {SHIFT_LABEL[member.shift] ?? member.shift}
        </div>
        {handledAlerts.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {handledAlerts.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300">
                <span className="font-semibold">{a.resident_id}</span>
                <span className="text-zinc-500">{LEVEL_LABELS[a.level]}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Guard assignment buttons */}
      <div className="flex-shrink-0 flex flex-col gap-1">
        {assignableWings.map((wing) =>
          guards[wing] !== member.name ? (
            <button
              key={wing}
              disabled={busy}
              onClick={() => onAssignGuard(wing, member.name)}
              className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:border-purple-600 hover:text-purple-300 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              Garde Aile {wing}
            </button>
          ) : (
            <span key={wing} className="text-[11px] px-2 py-1 rounded border border-purple-700 text-purple-300 whitespace-nowrap">
              ✓ Garde Aile {wing}
            </span>
          )
        )}
      </div>
    </div>
  );
}
