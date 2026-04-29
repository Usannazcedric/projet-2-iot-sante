import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

interface Row { time: string; field: string; value: number; }
interface Props {
  rows: Row[];
  fields: string[];
  height?: number;
}

export function VitalChart({ rows, fields, height = 280 }: Props) {
  // Pivot rows: { ts, hr, spo2, temp, ... }
  const byTs = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const ts = r.time;
    if (!byTs.has(ts)) byTs.set(ts, { time: ts });
    byTs.get(ts)![r.field] = r.value;
  }
  const data = Array.from(byTs.values()).sort((a, b) =>
    String(a.time).localeCompare(String(b.time)),
  );
  const colors: Record<string, string> = { hr: "#dc2626", spo2: "#2563eb", temp: "#16a34a", sys: "#9333ea", dia: "#a855f7" };

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} tickFormatter={(v) => String(v).slice(11, 16)} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend />
          {fields.map((f) => (
            <Line key={f} type="monotone" dataKey={f} stroke={colors[f] ?? "#64748b"} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
