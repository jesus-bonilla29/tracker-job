import type { SkillTrend } from "../api/types";

/** Con menos ofertas que esto en un periodo, el porcentaje es poco fiable y el punto se dibuja hueco. */
export const LOW_SAMPLE = 10;

export interface PointDetail {
  pct: number;
  mentions: number;
  jobs: number;
}

export interface TrendRow {
  period: string;
  /** Detalle por tecnología (nº de ofertas), para el tooltip y la tabla. */
  detail: Record<string, PointDetail | undefined>;
  /** Y además, una clave por tecnología con su % (formato plano que necesita Recharts). */
  [name: string]: number | string | Record<string, PointDetail | undefined> | undefined;
}

/** Une las series de varias tecnologías en filas por periodo (la unión de todos los periodos, en orden). */
export function mergeTrends(trends: SkillTrend[]): TrendRow[] {
  const periods = [...new Set(trends.flatMap((t) => t.series.map((p) => p.period)))].sort();
  return periods.map((period) => {
    const row: TrendRow = { period, detail: {} };
    for (const t of trends) {
      const p = t.series.find((x) => x.period === period);
      if (p) {
        row[t.skill.name] = p.pct;
        row.detail[t.skill.name] = { pct: p.pct, mentions: p.mentions, jobs: p.jobs };
      }
    }
    return row;
  });
}

/** Índice de la última fila en la que la tecnología tiene dato (ahí se coloca su etiqueta directa). */
export function lastIndexWithValue(rows: TrendRow[], name: string): number {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]?.detail[name]) return i;
  return -1;
}

/** Plazas de color estables: una tecnología conserva su color mientras siga seleccionada. */
export const MAX_SKILLS = 3;
export interface Selected {
  name: string;
  slot: 1 | 2 | 3;
}
export function addSelected(list: Selected[], name: string): Selected[] {
  if (list.length >= MAX_SKILLS || list.some((s) => s.name === name)) return list;
  const used = new Set(list.map((s) => s.slot));
  const slot = ([1, 2, 3] as const).find((n) => !used.has(n));
  return slot ? [...list, { name, slot }] : list;
}
export const removeSelected = (list: Selected[], name: string): Selected[] => list.filter((s) => s.name !== name);

/**
 * Eje Y con marcas redondas (0, 10, 20…) en vez de las que elige Recharts por su cuenta (0, 15, 30, 45, 50).
 * El máximo sube al siguiente múltiplo de 10 y el paso se adapta al rango para no llenar el eje de etiquetas.
 */
export function yAxisScale(rows: TrendRow[], names: string[]): { max: number; ticks: number[] } {
  let peak = 0;
  for (const row of rows) for (const n of names) peak = Math.max(peak, row.detail[n]?.pct ?? 0);
  const max = Math.max(10, Math.ceil(peak / 10) * 10);
  const step = max <= 20 ? 5 : max <= 50 ? 10 : 20;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return { max, ticks };
}
