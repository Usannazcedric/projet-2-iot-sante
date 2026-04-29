export interface VitalsValues { hr: number; spo2: number; sys: number; dia: number; temp: number; }
export interface MotionValues { ax: number; ay: number; az: number; activity: string; }
export interface ResidentSnapshot {
  resident_id: string;
  last_seen?: string | null;
  vitals?: VitalsValues | null;
  motion?: MotionValues | null;
  risk?: number | null;
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
  ackAlert: (id: string) => http<Alert>(`${API_BASE}/alerts/${id}/ack`, { method: "POST" }),
  resolveAlert: (id: string) => http<Alert>(`${API_BASE}/alerts/${id}/resolve`, { method: "POST" }),
  injectScenario: (residentId: string, name: string) =>
    http<unknown>(`${SIM_BASE}/scenario/${residentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
};
