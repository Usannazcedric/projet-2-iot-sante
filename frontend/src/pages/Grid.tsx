import { useStore, highestLevelFor } from "@/store/store";
import { ResidentCard } from "@/components/ResidentCard";
import { useMemo } from "react";

const LEGEND = [
  { cls: "border-zinc-600", label: "Normal" },
  { cls: "border-blue-500", label: "Information" },
  { cls: "border-yellow-400", label: "Attention" },
  { cls: "border-orange-500", label: "Alerte" },
  { cls: "border-red-500", label: "Urgence" },
  { cls: "border-white", label: "Danger vital" },
];

export function GridPage() {
  const residents = useStore((s) => s.residents);
  const alerts = useStore((s) => s.alerts);

  const sorted = useMemo(() => {
    const arr = Array.from(residents.values()).map((r) => ({
      r,
      level: highestLevelFor(r.resident_id, alerts),
    }));
    arr.sort((a, b) => b.level - a.level || a.r.resident_id.localeCompare(b.r.resident_id));
    return arr;
  }, [residents, alerts]);

  const stats = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (const { level } of sorted) counts[Math.min(level, 5)]++;
    return counts;
  }, [sorted]);

  if (sorted.length === 0) {
    return (
      <div className="p-12 flex flex-col items-center gap-3 text-zinc-400">
        <div className="h-8 w-8 border-4 border-zinc-700 border-t-purple-500 rounded-full animate-spin" />
        <div className="text-lg font-medium text-zinc-300">Connexion aux capteurs en cours…</div>
        <div className="text-sm">Les données des résidents arrivent dans quelques secondes.</div>
      </div>
    );
  }

  const urgentCount = stats[3] + stats[4] + stats[5];

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm text-zinc-400 font-medium">
          {sorted.length} résidents surveillés
        </div>
        <div className="flex flex-wrap gap-2">
          {stats[0] > 0 && (
            <span className="px-2 py-1 rounded-full text-xs bg-zinc-800 text-zinc-300">
              {stats[0]} sans alerte
            </span>
          )}
          {stats[1] > 0 && (
            <span className="px-2 py-1 rounded-full text-xs bg-blue-950 text-blue-300 border border-blue-800">
              {stats[1]} information
            </span>
          )}
          {stats[2] > 0 && (
            <span className="px-2 py-1 rounded-full text-xs bg-yellow-950 text-yellow-300 border border-yellow-800">
              {stats[2]} attention
            </span>
          )}
          {stats[3] > 0 && (
            <span className="px-2 py-1 rounded-full text-xs bg-orange-950 text-orange-300 border border-orange-800">
              {stats[3]} alerte
            </span>
          )}
          {(stats[4] > 0 || stats[5] > 0) && (
            <span className="px-2 py-1 rounded-full text-xs bg-red-950 text-red-300 border border-red-700 font-semibold animate-pulse">
              {stats[4] + stats[5]} urgence{stats[4] + stats[5] > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="ml-auto hidden lg:flex items-center gap-4 text-xs text-zinc-500">
          <span className="text-zinc-600 font-medium">Légende :</span>
          {LEGEND.map(({ cls, label }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-sm border-2 ${cls} inline-block`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {urgentCount > 0 && (
        <div className="bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300 flex items-center justify-between">
          <span>
            <strong className="text-red-200">{urgentCount} résident{urgentCount > 1 ? "s" : ""} nécessite{urgentCount > 1 ? "nt" : ""} une intervention immédiate.</strong>
            {" "}Les cartes avec un contour rouge ou blanc sont prioritaires.
          </span>
          <a href="/alerts" className="ml-4 underline whitespace-nowrap text-red-200 hover:text-white">
            Voir les alertes →
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {sorted.map(({ r, level }) => (
          <ResidentCard key={r.resident_id} resident={r} level={level} />
        ))}
      </div>

<div className="lg:hidden border border-zinc-800 rounded-lg p-3">
        <div className="text-xs text-zinc-500 font-medium mb-2">Légende des couleurs de bordure :</div>
        <div className="flex flex-wrap gap-3">
          {LEGEND.map(({ cls, label }) => (
            <span key={label} className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className={`h-3 w-3 rounded-sm border-2 ${cls} inline-block`} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
