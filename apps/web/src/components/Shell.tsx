import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useHealth, useOverview } from "../api/hooks";
import { fmtInt, relativeTime, sourceLabel } from "../lib/format";

const LINKS = [
  { to: "/", label: "Tecnologías", end: true },
  { to: "/tendencias", label: "Tendencias" },
  { to: "/fuentes", label: "Fuentes" },
  { to: "/ofertas", label: "Ofertas" },
  { to: "/mi-match", label: "Mi match" },
];

function readTheme(): "light" | "dark" {
  const forced = document.documentElement.dataset.theme;
  if (forced === "light" || forced === "dark") return forced;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("tjt-theme", next);
        } catch {
          // sin almacenamiento (modo privado): el cambio vale solo para esta visita
        }
        setTheme(next);
      }}
    >
      Tema {next === "dark" ? "oscuro" : "claro"}
    </button>
  );
}

/** Una frase con el estado de los datos: cuántas ofertas hay y cuándo se actualizó cada fuente. */
function StatusLine() {
  const overview = useOverview();
  const health = useHealth();
  if (!overview.data || !health.data) return <p className="status-line" aria-live="polite" />;

  const { jobs, techJobs } = overview.data.totals;
  const runs = health.data.etl
    .filter((r) => r.status === "ok" && r.finishedAt)
    .map((r) => `${sourceLabel(r.source)} ${relativeTime(r.finishedAt as string)}`);

  return (
    <p className="status-line num" aria-live="polite">
      {fmtInt(jobs)} ofertas guardadas, {fmtInt(techJobs)} de tecnología.
      {runs.length > 0 && ` Última actualización: ${runs.join(", ")}.`}
    </p>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = "es";
  }, []);

  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="site-header">
        <div className="wrap">
          <NavLink to="/" className="brand" aria-label="Tech Job Tracker, inicio">
            <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="currentColor" />
              <rect x="7" y="17" width="4" height="8" rx="1" fill="var(--surface)" />
              <rect x="14" y="11" width="4" height="14" rx="1" fill="var(--surface)" />
              <rect x="21" y="6" width="4" height="19" rx="1" fill="var(--series-1)" />
            </svg>
            Tech Job Tracker
          </NavLink>
          <nav className="nav" aria-label="Secciones">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <div className="wrap">
        <StatusLine />
      </div>
      <main id="contenido" className="wrap" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <p>
            Ofertas de{" "}
            <a href="https://remotive.com" target="_blank" rel="noopener noreferrer">Remotive</a>,{" "}
            <a href="https://www.arbeitnow.com" target="_blank" rel="noopener noreferrer">Arbeitnow</a> y{" "}
            <a href="https://news.ycombinator.com/user?id=whoishiring" target="_blank" rel="noopener noreferrer">Hacker News (“Who is hiring?”)</a>.
            Cada oferta enlaza a su publicación original; los datos de Remotive llegan con 24 horas de retraso.
          </p>
          <p>Los porcentajes son sobre las ofertas de tecnología de cada fuente. Las fuentes no son poblaciones equivalentes: compáralas con cautela.</p>
        </div>
      </footer>
    </>
  );
}
