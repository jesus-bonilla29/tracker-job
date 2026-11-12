import type { Diff, SkillShare, SourceComparison } from "../api/types";
import { sourceLabel } from "./format";

/**
 * El titular lo escribe el dato: "Python aparece en 1 de cada 4 ofertas tecnológicas".
 * Con ≥ 50 % no tiene sentido "1 de cada 2", así que se dice "más de la mitad".
 */
export function headline(skills: SkillShare[], totalJobs: number, source?: string): string {
  const scope = source ? ` de ${sourceLabel(source)}` : "";
  const top = skills[0];
  if (!top || totalJobs === 0) return "Todavía no hay ofertas para mostrar";
  if (top.pct >= 50) return `${top.name} aparece en más de la mitad de las ofertas tecnológicas${scope}`;
  return `${top.name} aparece en 1 de cada ${Math.max(2, Math.round(100 / top.pct))} ofertas tecnológicas${scope}`;
}

/**
 * Margen de error (95 %) de la diferencia entre dos porcentajes, en puntos porcentuales, en el peor caso (p = 50 %).
 * Con 121 ofertas frente a 1.008 sale ≈ 9 pp: por debajo de eso, una diferencia es indistinguible del azar.
 */
export function noiseMarginPp(nA: number, nB: number): number {
  if (nA <= 0 || nB <= 0) return Infinity;
  return 100 * 1.96 * Math.sqrt(0.25 / nA + 0.25 / nB);
}

export interface CompareRow {
  name: string;
  /** Diferencia absoluta en pp (siempre positiva: el lado indica quién gana). */
  size: number;
  pctA: number;
  pctB: number;
  /** true si la diferencia cabe dentro del margen de ruido. */
  noise: boolean;
}

export function buildCompareRows(cmp: SourceComparison): { margin: number; left: CompareRow[]; right: CompareRow[] } {
  const margin = noiseMarginPp(cmp.a.techJobs, cmp.b.techJobs);
  const row = (d: Diff): CompareRow => ({
    name: d.name,
    size: Math.abs(d.diff),
    pctA: d.pctA,
    pctB: d.pctB,
    noise: Math.abs(d.diff) < margin,
  });
  return { margin, left: cmp.moreInA.map(row), right: cmp.moreInB.map(row) };
}

export const categoriesOf = (skills: SkillShare[]): string[] => {
  const counts = new Map<string, number>();
  for (const s of skills) if (s.category) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([c]) => c);
};
