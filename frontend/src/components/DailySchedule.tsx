import { useEffect, useMemo, useState } from "react";
import { api, type ActivityHour } from "@/lib/api";

// ── colours & labels ──────────────────────────────────────────────────────────
const COLORS: Record<string, string> = {
  lying:         "bg-violet-700",
  idle:          "bg-zinc-500",
  sitting:       "bg-sky-700",
  walking:       "bg-green-600",
  fall_detected: "bg-red-600",
  expected:      "bg-zinc-700",   // expected but no data yet
};
const LABELS: Record<string, string> = {
  lying:         "Allongé / couché",
  idle:          "Debout / repos",
  sitting:       "Assis",
  walking:       "En mouvement",
  fall_detected: "Chute détectée",
};

// ── profile routines (copied from profiles.json) ──────────────────────────────
const ROUTINES: Record<string, { wake: string; sleep: string; meals: string[] }> = {
  R001: { wake: "07:00", sleep: "22:00", meals: ["08:00", "12:30", "19:00"] },
  R002: { wake: "06:30", sleep: "21:30", meals: ["08:00", "12:30", "19:00"] },
  R003: { wake: "07:30", sleep: "21:00", meals: ["08:00", "12:30", "19:00"] },
  R004: { wake: "07:00", sleep: "22:00", meals: ["08:00", "12:30", "19:00"] },
  R005: { wake: "08:00", sleep: "20:30", meals: ["08:30", "12:30", "19:00"] },
  R006: { wake: "06:30", sleep: "22:30", meals: ["08:00", "12:30", "19:30"] },
  R007: { wake: "07:00", sleep: "21:30", meals: ["08:00", "12:30", "19:00"] },
  R008: { wake: "07:00", sleep: "22:00", meals: ["08:00", "12:30", "19:00"] },
  R009: { wake: "07:30", sleep: "21:00", meals: ["08:00", "12:30", "19:00"] },
  R010: { wake: "07:00", sleep: "22:00", meals: ["08:00", "12:30", "19:00"] },
  R011: { wake: "07:00", sleep: "21:30", meals: ["08:00", "12:30", "19:00"] },
  R012: { wake: "06:45", sleep: "22:00", meals: ["08:00", "12:30", "19:00"] },
  R013: { wake: "08:00", sleep: "20:30", meals: ["08:30", "12:30", "19:00"] },
  R014: { wake: "07:00", sleep: "22:00", meals: ["08:00", "12:30", "19:00"] },
  R015: { wake: "07:30", sleep: "21:30", meals: ["08:00", "12:30", "19:00"] },
  R016: { wake: "06:30", sleep: "22:00", meals: ["08:00", "12:30", "19:00"] },
  R017: { wake: "08:00", sleep: "20:30", meals: ["08:30", "12:30", "19:00"] },
  R018: { wake: "07:00", sleep: "22:30", meals: ["08:00", "12:30", "19:00"] },
  R019: { wake: "07:30", sleep: "21:00", meals: ["08:00", "12:30", "19:00"] },
  R020: { wake: "07:00", sleep: "22:00", meals: ["08:00", "12:30", "19:00"] },
};

// ── helpers ───────────────────────────────────────────────────────────────────
function toH(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h + m / 60;
}

function toParisMinutes(d: Date): number {
  // Use Intl to get Paris local time (handles CET/CEST automatically)
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

/** Dominant observed activity, priority: fall > walking > sitting > lying > idle */
function dominant(d: ActivityHour): string | null {
  const PRIORITY = ["fall_detected", "walking", "sitting", "lying", "idle"];
  for (const act of PRIORITY) {
    if (Number(d[act] ?? 0) > 0) return act;
  }
  return null;
}

/** Expected activity for a 30-min slot index (0..47 = 00:00..23:30) */
function expected(slot: number, r: { wake: string; sleep: string; meals: string[] }): string {
  const h = slot / 2; // hours since midnight (local)
  const wake = toH(r.wake);
  const sleep = toH(r.sleep);
  if (h < wake || h >= sleep) return "lying";
  if (r.meals.some((m) => Math.abs(h - toH(m)) < 0.5)) return "sitting";
  return "idle";
}

// ── marker component ──────────────────────────────────────────────────────────
function Marker({ at, icon, label, row = 0 }: { at: number; icon: string; label: string; row?: number }) {
  return (
    <div
      className="absolute flex flex-col items-center -translate-x-1/2"
      style={{ left: `${(at / 24) * 100}%`, top: row === 0 ? 0 : 14 }}
    >
      <div className="h-1.5 w-px bg-zinc-600" />
      <span className="text-[9px] text-zinc-400 whitespace-nowrap leading-tight">{icon} {label}</span>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export function DailySchedule({ residentId }: { residentId: string }) {
  const [data, setData] = useState<ActivityHour[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.getActivityPattern(residentId, 24);
        if (!cancelled) setData(res.data);
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [residentId]);

  const routine = ROUTINES[residentId] ?? ROUTINES.R001;
  const nowMinutes = useMemo(() => toParisMinutes(new Date()), []);
  const nowPct = (nowMinutes / 1440) * 100;

  // Build observed slot map: Paris 30-min slot (0..47) → dominant activity
  const observed = useMemo(() => {
    const map: Record<number, string> = {};
    for (const d of data) {
      const date = new Date(d.hour);
      const minutes = toParisMinutes(date);
      // Check it's from today (minutes should be ≤ current time roughly)
      const slot = Math.floor(minutes / 30); // 0..47
      if (slot >= 0 && slot < 48) {
        const act = dominant(d);
        if (act) map[slot] = act;
      }
    }
    return map;
  }, [data]);

  const slots = useMemo(() =>
    Array.from({ length: 48 }, (_, i) => {
      const obs = observed[i];
      const exp = expected(i, routine);
      return { obs, exp, isFuture: i * 30 > nowMinutes };
    }),
  [observed, routine, nowMinutes]);

  // Time labels every 2h
  const timeLabels = Array.from({ length: 13 }, (_, i) => i * 2);

  if (loading) {
    return <div className="text-zinc-500 text-sm py-4 text-center animate-pulse">Chargement…</div>;
  }

  const hasObserved = Object.keys(observed).length > 0;

  return (
    <div className="space-y-3">
      {/* Time axis */}
      <div className="relative h-4 mx-1">
        {timeLabels.map((h) => (
          <span
            key={h}
            className="absolute text-[10px] text-zinc-500 -translate-x-1/2 select-none"
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {String(h).padStart(2, "0")}h
          </span>
        ))}
      </div>

      {/* ── Prévu (expected) ── */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Routine prévue</div>
        <div className="flex h-7 rounded overflow-hidden ring-1 ring-zinc-800">
          {slots.map(({ exp }, i) => (
            <div
              key={i}
              className={`flex-1 ${COLORS[exp] ?? "bg-zinc-700"} opacity-60`}
              title={`${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"} — ${LABELS[exp] ?? exp}`}
            />
          ))}
        </div>
      </div>

      {/* ── Observé (actual) ── */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1 flex items-center gap-2">
          Activité observée
          {!hasObserved && (
            <span className="text-zinc-600 normal-case tracking-normal font-normal">
              — données en cours d'accumulation
            </span>
          )}
        </div>
        <div className="flex h-7 rounded overflow-hidden ring-1 ring-zinc-800 relative">
          {slots.map(({ obs, isFuture }, i) => {
            const color = obs ? COLORS[obs] : "bg-zinc-800";
            const hh = String(Math.floor(i / 2)).padStart(2, "0");
            const mm = i % 2 === 0 ? "00" : "30";
            const label = obs ? (LABELS[obs] ?? obs) : "Aucune donnée";
            return (
              <div
                key={i}
                className={`flex-1 ${color} ${isFuture ? "opacity-20" : ""} transition-colors`}
                title={`${hh}:${mm} — ${label}`}
              />
            );
          })}
          {/* Current time marker */}
          <div
            className="absolute top-0 bottom-0 w-px bg-white/70 pointer-events-none"
            style={{ left: `${nowPct}%` }}
          />
        </div>
      </div>

      {/* Markers */}
      <div className="relative h-12 mx-1">
        {(() => {
          const all = [
            { at: toH(routine.wake),  icon: "☀️", label: routine.wake },
            ...routine.meals.map((m) => ({ at: toH(m), icon: "🍽️", label: m })),
            { at: toH(routine.sleep), icon: "🌙", label: routine.sleep },
          ].sort((a, b) => a.at - b.at);
          const rowEnd = [-Infinity, -Infinity];
          return all.map((m, i) => {
            const row = m.at - rowEnd[0] >= 1.5 ? 0 : 1;
            rowEnd[row] = m.at;
            return <Marker key={i} at={m.at} icon={m.icon} label={m.label} row={row} />;
          });
        })()}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-1">
        {Object.entries(LABELS).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded-sm ${COLORS[k]}`} />
            <span className="text-xs text-zinc-400">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
