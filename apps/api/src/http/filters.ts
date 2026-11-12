import type { Sql } from "./sql.js";

export interface JobFilters {
  source?: string | undefined;
  /** AAAA-MM-DD, inclusive. Compara contra la fecha de publicación de la oferta, en UTC. */
  from?: string | undefined;
  /** AAAA-MM-DD, inclusive. */
  to?: string | undefined;
  remote?: boolean | undefined;
  /** Por defecto solo cuentan las ofertas de tecnología (`is_tech`). */
  includeNonTech?: boolean | undefined;
}

/** Añade al WHERE las condiciones comunes a todos los endpoints. `alias` es el alias de la tabla jobs. */
export function applyJobFilters(sql: Sql, f: JobFilters, alias = "j"): void {
  if (!f.includeNonTech) sql.where(`${alias}.is_tech`);
  if (f.source) sql.where(`${alias}.source = ?`, f.source);
  if (f.from) sql.where(`${alias}.posted_at >= (?::date)::timestamp AT TIME ZONE 'UTC'`, f.from);
  if (f.to) sql.where(`${alias}.posted_at < ((?::date) + 1)::timestamp AT TIME ZONE 'UTC'`, f.to);
  if (f.remote !== undefined) sql.where(`${alias}.is_remote = ?`, f.remote);
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const pct = (part: number, whole: number): number => (whole > 0 ? round1((100 * part) / whole) : 0);
