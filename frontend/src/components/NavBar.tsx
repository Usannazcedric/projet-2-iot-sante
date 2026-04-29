import { NavLink } from "react-router-dom";
import { useStore } from "@/store/store";

export function NavBar() {
  const connected = useStore((s) => s.connected);
  const alertCount = useStore((s) => s.alerts.size);
  const link = "px-3 py-1.5 rounded-md text-sm font-medium text-zinc-300 hover:bg-zinc-800";
  const active = "bg-purple-600 text-white hover:bg-purple-700";
  return (
    <nav className="border-b border-zinc-800 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
        <div className="font-bold text-white">EHPAD — Monitoring santé</div>
        <NavLink to="/" end className={({ isActive }) => `${link} ${isActive ? active : ""}`}>Tableau</NavLink>
        <NavLink to="/alerts" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
          Alertes {alertCount > 0 && <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-600 text-white text-xs px-2 py-0.5">{alertCount}</span>}
        </NavLink>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-zinc-400">{connected ? "en ligne" : "hors ligne"}</span>
        </div>
      </div>
    </nav>
  );
}
