interface Props {
  label: string;
  value: number | null | undefined;
  unit?: string;
  warn?: (v: number) => boolean;
  crit?: (v: number) => boolean;
}

export function VitalGauge({ label, value, unit, warn, crit }: Props) {
  let cls = "text-white";
  if (typeof value === "number") {
    if (crit?.(value)) cls = "text-red-500";
    else if (warn?.(value)) cls = "text-orange-400";
  }
  return (
    <div className="flex flex-col items-start">
      <div className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={`text-2xl font-semibold leading-none ${cls}`}>
        {typeof value === "number" ? value : "—"}
        {unit && <span className="text-sm font-normal text-zinc-400 ml-1">{unit}</span>}
      </div>
    </div>
  );
}
