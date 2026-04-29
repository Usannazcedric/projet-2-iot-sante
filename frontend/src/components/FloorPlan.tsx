import { Link } from "react-router-dom";
import { useStore, highestLevelFor } from "@/store/store";
import type { RoomSnapshot } from "@/lib/api";
import { fmtRelative } from "@/lib/format";

const RING_BY_LEVEL: Record<number, string> = {
  0: "ring-zinc-700",
  1: "ring-blue-500",
  2: "ring-yellow-400",
  3: "ring-orange-500",
  4: "ring-red-500",
  5: "ring-white",
};

const WING_A = ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110"];
const WING_B = ["111", "112", "113", "114", "115", "116", "117", "118", "119", "120"];
const COMMON = [
  { id: "salle_commune", label: "Salle commune", icon: "Repas & Activités" },
  { id: "couloir", label: "Couloir", icon: "Circulation" },
];

interface RoomTileProps {
  room: RoomSnapshot | undefined;
  roomId: string;
  residentId?: string;
  level: number;
}

function RoomTile({ room, roomId, residentId, level }: RoomTileProps) {
  const pir = room?.pir === 1;
  const door = room?.door === 1;
  const ring = RING_BY_LEVEL[level] ?? RING_BY_LEVEL[0];

  const tile = (
    <div
      className={`
        relative rounded-md border p-2 text-center transition-all duration-500 select-none
        ring-1 ${ring}
        ${pir
          ? "bg-green-950 border-green-800 shadow-green-900/50 shadow-md"
          : "bg-zinc-900 border-zinc-800"
        }
        ${residentId ? "cursor-pointer hover:brightness-125" : "cursor-default"}
      `}
      title={`Chambre ${roomId}${residentId ? ` — ${residentId}` : ""}${pir ? " — Mouvement détecté" : ""}${door ? " — Porte ouverte" : ""}`}
    >
      {/* Door indicator */}
      {door && (
        <span
          className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-yellow-400 ring-2 ring-zinc-950"
          title="Porte ouverte"
        />
      )}
      {/* PIR pulse */}
      {pir && (
        <span className="absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full bg-green-400 animate-ping opacity-75" />
      )}

      <div className="text-[10px] font-bold text-zinc-400">{roomId}</div>
      {residentId && (
        <div className={`text-[9px] mt-0.5 ${pir ? "text-green-400" : "text-zinc-600"}`}>
          {residentId}
        </div>
      )}
      <div className={`mt-1 h-1.5 w-full rounded-full ${pir ? "bg-green-500" : "bg-zinc-800"}`} />
    </div>
  );

  if (residentId) {
    return <Link to={`/resident/${residentId}`}>{tile}</Link>;
  }
  return tile;
}

interface CommonTileProps {
  room: RoomSnapshot | undefined;
  label: string;
  sublabel: string;
}

function CommonTile({ room, label, sublabel }: CommonTileProps) {
  const pir = room?.pir === 1;
  return (
    <div
      className={`
        rounded-md border px-3 py-2 text-center transition-all duration-500 flex-1
        ${pir ? "bg-green-950 border-green-800" : "bg-zinc-900 border-zinc-800"}
      `}
    >
      {pir && <span className="inline-block h-2 w-2 rounded-full bg-green-400 animate-ping mr-1" />}
      <span className={`text-xs font-semibold ${pir ? "text-green-300" : "text-zinc-500"}`}>{label}</span>
      <div className="text-[9px] text-zinc-600 mt-0.5">{sublabel}</div>
    </div>
  );
}

export function FloorPlan() {
  const rooms = useStore((s) => s.rooms);
  const alerts = useStore((s) => s.alerts);

  const residentByRoom = useStore((s) => {
    const map: Record<string, string> = {};
    for (const r of s.rooms.values()) {
      if (r.resident_id) map[r.room_id] = r.resident_id;
    }
    return map;
  });

  const getLevel = (roomId: string) => {
    const rid = residentByRoom[roomId];
    return rid ? highestLevelFor(rid, alerts) : 0;
  };

  const activePir = Array.from(rooms.values()).filter((r) => r.pir === 1).length;
  const openDoors = Array.from(rooms.values()).filter((r) => r.door === 1).length;

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-400 animate-ping" />
          <span>Mouvement détecté ({activePir})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-yellow-400" />
          <span>Porte ouverte ({openDoors})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span>Aucun mouvement</span>
        </div>
        <div className="ml-auto text-zinc-600 text-[10px]">Mis à jour en temps réel · cliquer sur une chambre pour voir le résident</div>
      </div>

      {/* Common areas */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Zones communes</div>
        <div className="flex gap-2">
          {COMMON.map(({ id, label, icon }) => (
            <CommonTile key={id} room={rooms.get(id)} label={label} sublabel={icon} />
          ))}
        </div>
      </div>

      {/* Wing A */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Aile A — Chambres 101–110</div>
        <div className="grid grid-cols-5 gap-1.5">
          {WING_A.map((rid) => (
            <RoomTile
              key={rid}
              roomId={rid}
              room={rooms.get(rid)}
              residentId={residentByRoom[rid]}
              level={getLevel(rid)}
            />
          ))}
        </div>
      </div>

      {/* Wing B */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Aile B — Chambres 111–120</div>
        <div className="grid grid-cols-5 gap-1.5">
          {WING_B.map((rid) => (
            <RoomTile
              key={rid}
              roomId={rid}
              room={rooms.get(rid)}
              residentId={residentByRoom[rid]}
              level={getLevel(rid)}
            />
          ))}
        </div>
      </div>

      {rooms.size === 0 && (
        <div className="text-center text-zinc-500 text-sm py-6">
          En attente des données capteurs…
        </div>
      )}
    </div>
  );
}
