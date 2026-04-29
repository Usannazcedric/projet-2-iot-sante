import type { RoomSnapshot } from "@/lib/api";
import { fmtRelative } from "@/lib/format";

interface Props {
  room: RoomSnapshot;
  compact?: boolean;
}

export function RoomStatus({ room, compact = false }: Props) {
  const pirActive = room.pir === 1;
  const doorOpen = room.door === 1;

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
            pirActive ? "bg-green-900/60 text-green-300" : "bg-zinc-800 text-zinc-500"
          }`}
          title="Détecteur de mouvement (PIR)"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pirActive ? "bg-green-400" : "bg-zinc-600"}`} />
          {pirActive ? "Mouvement" : "Immobile"}
        </span>
        <span
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
            doorOpen ? "bg-yellow-900/60 text-yellow-300" : "bg-zinc-800 text-zinc-500"
          }`}
          title="Capteur de porte"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${doorOpen ? "bg-yellow-400" : "bg-zinc-600"}`} />
          {doorOpen ? "Porte ouverte" : "Porte fermée"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-4 flex-wrap">
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Détecteur de mouvement</div>
        <div className={`flex items-center gap-2 text-sm font-medium ${pirActive ? "text-green-400" : "text-zinc-400"}`}>
          <span className={`h-3 w-3 rounded-full ${pirActive ? "bg-green-400 animate-pulse" : "bg-zinc-700"}`} />
          {pirActive ? "Mouvement détecté" : "Aucun mouvement"}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Porte de chambre</div>
        <div className={`flex items-center gap-2 text-sm font-medium ${doorOpen ? "text-yellow-400" : "text-zinc-400"}`}>
          <span className={`h-3 w-3 rounded-full ${doorOpen ? "bg-yellow-400" : "bg-zinc-700"}`} />
          {doorOpen ? "Ouverte" : "Fermée"}
        </div>
      </div>
      {room.last_seen && (
        <div className="flex flex-col gap-1 ml-auto text-right">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Dernière mise à jour</div>
          <div className="text-xs text-zinc-400">il y a {fmtRelative(room.last_seen)}</div>
        </div>
      )}
    </div>
  );
}
