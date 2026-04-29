import { useEffect } from "react";
import { useStore } from "@/store/store";
import { api } from "@/lib/api";
import { createWebSocket } from "@/lib/ws";
import { useToasts } from "./useToasts";
import { LEVEL_LABELS } from "@/lib/format";

export function useBootstrap() {
  const setResidentBulk = useStore((s) => s.setResidentBulk);
  const setAlertBulk = useStore((s) => s.setAlertBulk);
  const setResident = useStore((s) => s.setResident);
  const upsertAlert = useStore((s) => s.upsertAlert);
  const setConnected = useStore((s) => s.setConnected);
  const setRoom = useStore((s) => s.setRoom);
  const setRoomBulk = useStore((s) => s.setRoomBulk);
  const pushToast = useToasts((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [residents, alerts, rooms] = await Promise.all([
          api.listResidents(),
          api.listAlerts(),
          api.listRooms().catch(() => []),
        ]);
        if (cancelled) return;
        setResidentBulk(residents);
        setAlertBulk(alerts);
        setRoomBulk(rooms);
      } catch (err) {
        console.error("bootstrap_failed", err);
      }
    })();

    const close = createWebSocket(
      (env) => {
        const t = env.topic;
        if (t.startsWith("state/resident/")) {
          setResident(env.data);
        } else if (t === "alerts/new") {
          upsertAlert(env.data);
          if (env.data?.level >= 3) {
            pushToast({
              title: `${LEVEL_LABELS[env.data.level] ?? "Alerte"} — ${env.data.resident_id}`,
              description: env.data.reason,
              level: env.data.level,
            });
          }
        } else if (t.startsWith("alerts/update/")) {
          upsertAlert(env.data);
        } else if (t.startsWith("state/room/")) {
          if (env.data?.room_id) setRoom(env.data);
        } else if (t.startsWith("risk/resident/")) {
          if (env.data?.resident_id && typeof env.data?.risk === "number") {
            setResident({ resident_id: env.data.resident_id, risk: env.data.risk });
          }
        }
      },
      (ok) => setConnected(ok),
    );

    return () => {
      cancelled = true;
      close();
    };
  }, [setResidentBulk, setAlertBulk, setResident, upsertAlert, setConnected, pushToast, setRoom, setRoomBulk]);
}
