import { useEffect } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { Shell } from "./components/Shell";
import { EmptyState } from "./components/ui";
import { CompareView } from "./views/CompareView";
import { JobsView } from "./views/JobsView";
import { MatchView } from "./views/MatchView";
import { RankingView } from "./views/RankingView";
import { TrendView } from "./views/TrendView";

const TITLES: Record<string, string> = {
  "/": "Tecnologías más pedidas",
  "/tendencias": "Tendencias",
  "/fuentes": "Comparar fuentes",
  "/ofertas": "Ofertas",
  "/mi-match": "Mi match",
};

export function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `${TITLES[pathname] ?? "No encontrada"} · Tech Job Tracker`;
  }, [pathname]);

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<RankingView />} />
        <Route path="/tendencias" element={<TrendView />} />
        <Route path="/fuentes" element={<CompareView />} />
        <Route path="/ofertas" element={<JobsView />} />
        <Route path="/mi-match" element={<MatchView />} />
        <Route
          path="*"
          element={
            <EmptyState title="Esta página no existe">
              <Link to="/">Volver al ranking de tecnologías</Link>
            </EmptyState>
          }
        />
      </Routes>
    </Shell>
  );
}
