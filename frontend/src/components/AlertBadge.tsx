import { LEVEL_COLORS, LEVEL_LABELS } from "@/lib/format";

export function AlertBadge({ level }: { level: number }) {
  if (!level) return null;
  const color = LEVEL_COLORS[level] ?? "bg-slate-500";
  const text = level >= 5 ? "text-white" : level === 2 ? "text-slate-900" : "text-white";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${color} ${text}`}
      title={`Niveau ${level} sur 5`}
    >
      {LEVEL_LABELS[level] ?? "?"}
    </span>
  );
}
