import { NavLink } from "react-router-dom";
import { useStore } from "@/store/store";

export function NavBar() {
  const connected = useStore((s) => s.connected);
  const alertCount = useStore((s) => s.alerts.size);
  const link = "px-3 py-1.5 rounded-md text-sm font-medium hover:bg-slate-200";
  const active = "bg-slate-900 text-white hover:bg-slate-900";
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
        <div className="font-bold">EHPAD Monitoring</div>
        <NavLink to="/" end className={({ isActive }) => `${link} ${isActive ? active : ""}`}>Grid</NavLink>
        <NavLink to="/alerts" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
          Alerts {alertCount > 0 && <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-600 text-white text-xs px-2 py-0.5">{alertCount}</span>}
        </NavLink>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-slate-600">{connected ? "live" : "offline"}</span>
        </div>
      </div>
    </nav>
  );
}
