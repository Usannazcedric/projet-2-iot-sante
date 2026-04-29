export function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtRelative(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${Math.round(s / 3600)}h`;
}

export const LEVEL_LABELS: Record<number, string> = {
  1: "Information",
  2: "Attention",
  3: "Alerte",
  4: "Urgence",
  5: "Danger vital",
};

export const LEVEL_COLORS: Record<number, string> = {
  1: "bg-level-1",
  2: "bg-level-2",
  3: "bg-level-3",
  4: "bg-level-4",
  5: "bg-level-5",
};

export const LEVEL_DESCRIPTIONS: Record<number, string> = {
  1: "Situation à surveiller, pas d'urgence",
  2: "Constante légèrement anormale, à vérifier",
  3: "Anomalie significative, intervention conseillée",
  4: "Situation grave, intervention immédiate requise",
  5: "Urgence vitale — appeler le 15",
};

export const ACTIVITY_LABELS: Record<string, string> = {
  walking: "En marche",
  sitting: "Assis(e)",
  lying: "Allongé(e)",
  fall_detected: "CHUTE DETECTEE",
  stationary: "Immobile",
};

export const STATUS_BY_LEVEL: Record<number, { text: string; cls: string }> = {
  0: { text: "Tout va bien", cls: "text-green-400" },
  1: { text: "Information", cls: "text-blue-400" },
  2: { text: "Attention requise", cls: "text-yellow-400" },
  3: { text: "Alerte active", cls: "text-orange-400" },
  4: { text: "URGENCE", cls: "text-red-400 font-bold tracking-wide" },
  5: { text: "DANGER VITAL", cls: "text-white font-bold tracking-wider" },
};
