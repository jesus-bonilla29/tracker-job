const nf1 = new Intl.NumberFormat("es", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("es", { maximumFractionDigits: 0 });

export const fmtInt = (n: number): string => nf0.format(n);
export const fmtPct = (n: number): string => `${nf1.format(n)} %`;

/** Diferencia en puntos porcentuales con signo explícito (el signo menos tipográfico, no el guion). */
export const fmtPp = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}${nf1.format(Math.abs(n))} pp`;

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

/** "hace 3 horas", "hace 2 días". `now` es inyectable para poder probarlo. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86_400), "day");
}

/** Periodo "2026-10-01" → "oct 2026" (mes) o "1 oct" (semana: el día en que empieza). Siempre en UTC, como la API. */
export function fmtPeriod(period: string, interval: "week" | "month"): string {
  const d = new Date(`${period}T00:00:00Z`);
  return interval === "month"
    ? new Intl.DateTimeFormat("es", { month: "short", year: "numeric", timeZone: "UTC" }).format(d).replace(".", "")
    : new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(".", "");
}

export const fmtDate = (iso: string): string =>
  new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso)).replace(/\./g, "");

const SOURCE_LABELS: Record<string, string> = { hn: "Hacker News", arbeitnow: "Arbeitnow", remotive: "Remotive" };
export const sourceLabel = (s: string): string => SOURCE_LABELS[s] ?? s;

/** Cada fuente conserva SU color en toda la app (el color sigue a la entidad, no a su posición). */
const SOURCE_COLORS: Record<string, string> = { hn: "var(--series-1)", arbeitnow: "var(--series-2)", remotive: "var(--series-3)" };
export const sourceColor = (s: string): string => SOURCE_COLORS[s] ?? "var(--muted)";

const CATEGORY_LABELS: Record<string, string> = {
  language: "Lenguajes",
  backend: "Backend",
  frontend: "Frontend",
  database: "Bases de datos",
  devops: "DevOps",
  cloud: "Nube",
  data: "Datos",
  ai: "IA",
  testing: "Testing",
  mobile: "Móvil",
  tool: "Herramientas",
  practice: "Prácticas",
};
export const categoryLabel = (c: string): string => CATEGORY_LABELS[c] ?? c;

export function fmtSalary(min: number | null, max: number | null, currency: string | null): string | null {
  if (min === null && max === null) return null;
  const k = (n: number) => `${nf0.format(Math.round(n / 1000))}k`;
  const cur = currency ?? "";
  const range = min !== null && max !== null && min !== max ? `${k(min)}–${k(max)}` : k((max ?? min) as number);
  return `${range} ${cur}`.trim();
}

/**
 * La URL de una oferta viene de una fuente externa: solo se enlaza si es http(s). Así un "javascript:..." o un
 * "data:..." colado en los datos nunca llega a un href.
 */
export function safeHref(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** "Remote" / "Remoto" ya aparece en la ubicación de muchas ofertas: no repetirlo como etiqueta aparte. */
export const showRemoteBadge = (isRemote: boolean, location: string | null): boolean =>
  isRemote && !/\bremot[eo]\b/i.test(location ?? "");
