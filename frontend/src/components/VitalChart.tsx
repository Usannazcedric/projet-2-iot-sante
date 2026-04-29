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
  const colors: Record<string, string> = { hr: "#f87171", spo2: "#60a5fa", temp: "#4ade80", sys: "#a855f7", dia: "#c084fc" };

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#a1a1aa" }} tickFormatter={(v) => String(v).slice(11, 16)} stroke="#52525b" />
          <YAxis tick={{ fontSize: 10, fill: "#a1a1aa" }} stroke="#52525b" />
          <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", color: "#fff" }} />
          <Legend wrapperStyle={{ color: "#a1a1aa" }} />
          {fields.map((f) => (
            <Line key={f} type="monotone" dataKey={f} stroke={colors[f] ?? "#64748b"} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
