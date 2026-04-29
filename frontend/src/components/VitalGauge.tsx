interface Props {
  label: string;
  value: number | null | undefined;
  unit?: string;
  warn?: (v: number) => boolean;
  crit?: (v: number) => boolean;
  title?: string;
}

export function VitalGauge({ label, value, unit, warn, crit, title }: Props) {
  let cls = "text-white";
  let statusText = "";
  let statusCls = "";

  if (typeof value === "number") {
    if (crit?.(value)) {
      cls = "text-red-500";
      statusText = "Critique";
      statusCls = "text-red-500";
    } else if (warn?.(value)) {
      cls = "text-orange-400";
      statusText = "Attention";
      statusCls = "text-orange-400";
    } else if (warn || crit) {
      statusText = "Normal";
      statusCls = "text-green-500";
    }
  }

  return (
    <div className="flex flex-col items-start" title={title}>
      <div className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={`text-2xl font-semibold leading-none ${cls}`}>
        {typeof value === "number" ? value : "—"}
        {unit && <span className="text-sm font-normal text-zinc-400 ml-1">{unit}</span>}
      </div>
      {statusText && (
        <div className={`text-[9px] font-medium mt-0.5 ${statusCls}`}>{statusText}</div>
      )}
    </div>
  );
}
