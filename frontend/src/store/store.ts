import { create } from "zustand";
import type { Alert, ResidentSnapshot, RoomSnapshot } from "@/lib/api";

interface State {
  residents: Map<string, ResidentSnapshot>;
  alerts: Map<string, Alert>;
  rooms: Map<string, RoomSnapshot>;
  connected: boolean;
  setResident: (snap: ResidentSnapshot) => void;
  setResidentBulk: (snaps: ResidentSnapshot[]) => void;
  upsertAlert: (a: Alert) => void;
  setAlertBulk: (alerts: Alert[]) => void;
  removeAlert: (id: string) => void;
  setRoom: (room: RoomSnapshot) => void;
  setRoomBulk: (rooms: RoomSnapshot[]) => void;
  setConnected: (ok: boolean) => void;
}

export const useStore = create<State>((set) => ({
  residents: new Map(),
  alerts: new Map(),
  rooms: new Map(),
  connected: false,
  setResident: (snap) => set((s) => {
    const m = new Map(s.residents);
    const prev = m.get(snap.resident_id) ?? { resident_id: snap.resident_id };
    m.set(snap.resident_id, { ...prev, ...snap });
    return { residents: m };
  }),
  setResidentBulk: (snaps) => set(() => {
    const m = new Map<string, ResidentSnapshot>();
    for (const s of snaps) m.set(s.resident_id, s);
    return { residents: m };
  }),
  upsertAlert: (a) => set((s) => {
    const m = new Map(s.alerts);
    if (a.status === "resolved") m.delete(a.id);
    else m.set(a.id, a);
    return { alerts: m };
  }),
  setAlertBulk: (alerts) => set(() => {
    const m = new Map<string, Alert>();
    for (const a of alerts) if (a.status !== "resolved") m.set(a.id, a);
    return { alerts: m };
  }),
  removeAlert: (id) => set((s) => {
    const m = new Map(s.alerts);
    m.delete(id);
    return { alerts: m };
  }),
  setRoom: (room) => set((s) => {
    const m = new Map(s.rooms);
    m.set(room.room_id, room);
    return { rooms: m };
  }),
  setRoomBulk: (rooms) => set(() => {
    const m = new Map<string, RoomSnapshot>();
    for (const r of rooms) m.set(r.room_id, r);
    return { rooms: m };
  }),
  setConnected: (ok) => set({ connected: ok }),
}));

export function highestLevelFor(residentId: string, alerts: Map<string, Alert>): number {
  let best = 0;
  for (const a of alerts.values()) {
    if (a.resident_id === residentId && a.status !== "resolved" && a.level > best) best = a.level;
  }
  return best;
}
