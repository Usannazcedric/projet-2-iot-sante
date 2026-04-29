import { FloorPlan } from "@/components/FloorPlan";
import { useStore } from "@/store/store";

export function MovementsPage() {
  const rooms = useStore((s) => s.rooms);
  const activePir = Array.from(rooms.values()).filter((r) => r.pir === 1).length;
  const openDoors = Array.from(rooms.values()).filter((r) => r.door === 1).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Plan de l'établissement</h1>
          <div className="text-sm text-zinc-400 mt-0.5">
            Détection de mouvement en temps réel dans toutes les pièces
          </div>
        </div>
        <div className="ml-auto flex gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-green-400">{activePir}</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Mouvements</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-center">
            <div className="text-lg font-bold text-yellow-400">{openDoors}</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Portes ouvertes</div>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <FloorPlan />
      </div>
    </div>
  );
}
