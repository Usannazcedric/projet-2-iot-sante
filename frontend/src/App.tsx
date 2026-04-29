import { Routes, Route } from "react-router-dom";
import { useBootstrap } from "@/hooks/useBootstrap";
import { NavBar } from "@/components/NavBar";
import { AlertToast } from "@/components/AlertToast";
import { GridPage } from "@/pages/Grid";

export default function App() {
  useBootstrap();
  return (
    <div className="min-h-full">
      <NavBar />
      <main>
        <Routes>
          <Route path="/" element={<GridPage />} />
          <Route path="*" element={<div className="p-8 text-slate-500">Not found</div>} />
        </Routes>
      </main>
      <AlertToast />
    </div>
  );
}
