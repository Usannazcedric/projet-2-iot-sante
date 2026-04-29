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
        <div>
          <div className="font-bold text-white text-sm">Monitoring EHPAD</div>
          <div className="text-[10px] text-zinc-500">Surveillance des résidents en temps réel</div>
        </div>
        <div className="h-5 w-px bg-zinc-700 mx-1 hidden sm:block" />
        <NavLink to="/" end className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
          Tableau de bord
        </NavLink>
        <NavLink to="/alerts" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
          Alertes
          {alertCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-600 text-white text-xs px-2 py-0.5 font-semibold">
              {alertCount}
            </span>
          )}
        </NavLink>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
            title={connected ? "Connexion active aux capteurs" : "Déconnecté des capteurs"}
          />
          <span className="text-zinc-400">{connected ? "Capteurs connectés" : "Déconnecté"}</span>
        </div>
      </div>
    </nav>
  );
}
