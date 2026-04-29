import { useStore, highestLevelFor } from "@/store/store";
import { ResidentCard } from "@/components/ResidentCard";
import { useMemo } from "react";

export function GridPage() {
  const residents = useStore((s) => s.residents);
  const alerts = useStore((s) => s.alerts);

  const sorted = useMemo(() => {
    const arr = Array.from(residents.values()).map((r) => ({
      r, level: highestLevelFor(r.resident_id, alerts),
    }));
    arr.sort((a, b) => b.level - a.level || a.r.resident_id.localeCompare(b.r.resident_id));
    return arr;
  }, [residents, alerts]);

  if (sorted.length === 0) {
    return <div className="p-8 text-zinc-400">Chargement des résidents…</div>;
  }
  return (
    <div className="p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {sorted.map(({ r, level }) => (
          <ResidentCard key={r.resident_id} resident={r} level={level} />
        ))}
      </div>
    </div>
  );
}
