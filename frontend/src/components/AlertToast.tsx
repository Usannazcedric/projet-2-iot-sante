import { useToasts } from "@/hooks/useToasts";
import { LEVEL_COLORS } from "@/lib/format";

export function AlertToast() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((t) => {
        const color = t.level ? LEVEL_COLORS[t.level] ?? "bg-slate-700" : "bg-slate-700";
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`text-left rounded-md shadow-lg px-3 py-2 text-white ${color}`}
          >
            <div className="font-semibold text-sm">{t.title}</div>
            {t.description && <div className="text-xs opacity-90 mt-0.5">{t.description}</div>}
          </button>
        );
      })}
    </div>
  );
}
