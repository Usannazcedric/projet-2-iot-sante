import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { api, type ActivityHour } from "@/lib/api";

const ACTIVITY_CONFIG: Record<string, { label: string; color: string }> = {
  idle:          { label: "Repos / inactif", color: "#71717a" },
  sitting:       { label: "Assis",           color: "#3b82f6" },
  walking:       { label: "Marche",          color: "#22c55e" },
  lying:         { label: "Allongé",         color: "#a78bfa" },
  fall_detected: { label: "Chute",           color: "#ef4444" },
};

function fmtHour(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  } catch {
    return iso.slice(11, 16);
  }
}

export function ActivityPattern({ residentId }: { residentId: string }) {
  const [data, setData] = useState<ActivityHour[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getActivityPattern(residentId, 24);
        if (!cancelled) setData(res.data);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [residentId]);

  if (loading) {
    return <div className="text-zinc-400 text-sm py-4 text-center">Chargement des données…</div>;
  }

  if (data.length === 0) {
    return (
      <div className="text-zinc-400 text-sm py-4 text-center">
        Données insuffisantes — les patterns s'accumulent au fil du temps.
      </div>
    );
  }

  const present = Object.keys(ACTIVITY_CONFIG).filter((k) =>
    data.some((d) => Number(d[k] ?? 0) > 0),
  );

  const chartData = data.map((d) => ({
    hour: fmtHour(d.hour),
    ...Object.fromEntries(present.map((k) => [k, d[k] ?? 0])),
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} />
          <Tooltip
            contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "6px" }}
            labelStyle={{ color: "#e4e4e7", fontSize: 12 }}
            itemStyle={{ fontSize: 12 }}
          />
          <Legend
            formatter={(value) => (
              <span style={{ color: "#a1a1aa", fontSize: 11 }}>{ACTIVITY_CONFIG[value]?.label ?? value}</span>
            )}
          />
          {present.map((k) => (
            <Bar key={k} dataKey={k} stackId="a" fill={ACTIVITY_CONFIG[k]?.color ?? "#6b7280"} name={k} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
