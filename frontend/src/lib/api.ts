export interface VitalsValues { hr: number; spo2: number; sys: number; dia: number; temp: number; }
export interface MotionValues { ax: number; ay: number; az: number; activity: string; }
export interface ResidentSnapshot {
  resident_id: string;
  last_seen?: string | null;
  vitals?: VitalsValues | null;
  motion?: MotionValues | null;
  risk?: number | null;
}
export interface RoomSnapshot {
  room_id: string;
  resident_id?: string | null;
  pir: number;   // 0 ou 1
  door: number;  // 0 ou 1
  last_seen?: string | null;
}

export interface Alert {
  id: string;
  resident_id: string;
  level: number;
  reason: string;
  status: "active" | "acknowledged" | "resolved";
  created_at: string;
  updated_at: string;
  last_seen: string;
  acknowledged_by?: string | null;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  wing: string;
  shift: string;
  on_duty: boolean;
  is_guard: boolean;
  guard_wing: string | null;
}

export interface ActivityHour {
  hour: string;
  idle?: number;
  sitting?: number;
  walking?: number;
  lying?: number;
  fall_detected?: number;
  [key: string]: string | number | undefined;
}

const API_BASE = "/api";
const SIM_BASE = "/sim";

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => http<{ status: string }>(`${API_BASE}/health`),
  listResidents: () => http<ResidentSnapshot[]>(`${API_BASE}/residents`),
  getResident: (id: string) => http<ResidentSnapshot>(`${API_BASE}/residents/${id}`),
  getHistory: (id: string, metric: string, minutes: number) =>
    http<{ resident_id: string; metric: string; rows: Array<{ time: string; field: string; value: number }> }>(
      `${API_BASE}/residents/${id}/history?metric=${encodeURIComponent(metric)}&minutes=${minutes}`,
    ),
  listAlerts: () => http<Alert[]>(`${API_BASE}/alerts`),
  ackAlert: (id: string, by?: string) => http<Alert>(`${API_BASE}/alerts/${id}/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ by: by ?? null }),
  }),
  resolveAlert: (id: string) => http<Alert>(`${API_BASE}/alerts/${id}/resolve`, { method: "POST" }),
  listRooms: () => http<RoomSnapshot[]>(`${API_BASE}/rooms`),
  listStaff: () => http<StaffMember[]>(`${API_BASE}/staff`),
  getGuard: () => http<Record<string, string>>(`${API_BASE}/staff/guard`),
  setGuard: (wing: string, name: string) =>
    http<{ wing: string; guard: string }>(`${API_BASE}/staff/guard/${wing}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  getActivityPattern: (id: string, hours = 24) =>
    http<{ resident_id: string; hours: number; data: ActivityHour[] }>(
      `${API_BASE}/residents/${id}/activity-pattern?hours=${hours}`,
    ),
  injectScenario: (residentId: string, name: string) =>
    http<unknown>(`${SIM_BASE}/scenario/${residentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
};
