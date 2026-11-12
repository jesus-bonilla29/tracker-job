import type pg from "pg";

/**
 * Informe de tecnologías por fuente.
 *
 * Problema que resuelve: las fuentes aportan volúmenes muy distintos (p. ej. Arbeitnow ~1.500 ofertas frente a
 * ~200 de Hacker News), así que un ranking por conteo absoluto refleja casi solo a la más grande. Aquí cada
 * tecnología se expresa como PORCENTAJE de las ofertas tecnológicas de cada fuente, que sí es comparable.
 */

export interface SourceTotals {
  source: string;
  jobs: number;
  techJobs: number;
}

export interface SkillShare {
  skill: string;
  category: string | null;
  /** Ofertas tecnológicas que la mencionan, sumando todas las fuentes. */
  total: number;
  /** Por fuente: nº de ofertas y % sobre las ofertas tecnológicas de esa fuente. */
  bySource: Record<string, { count: number; pct: number }>;
}

export interface SkillShares {
  sources: SourceTotals[];
  skills: SkillShare[];
}

/** Con menos ofertas tecnológicas que esto, el porcentaje de una fuente es demasiado ruidoso para promediarlo. */
export const DEFAULT_MIN_TECH_JOBS = 20;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Lee de la base de datos cuántas ofertas tecnológicas menciona cada skill en cada fuente. Solo cuenta `is_tech`. */
export async function getSkillShares(pool: pg.Pool): Promise<SkillShares> {
  const totals = await pool.query<{ source: string; jobs: number; tech_jobs: number }>(
    `SELECT source, count(*)::int AS jobs, (count(*) FILTER (WHERE is_tech))::int AS tech_jobs
       FROM jobs GROUP BY source ORDER BY source`,
  );
  const counts = await pool.query<{ skill: string; category: string | null; source: string; cnt: number }>(
    `SELECT s.name AS skill, s.category, j.source, count(*)::int AS cnt
       FROM job_skills js
       JOIN jobs   j ON j.id = js.job_id AND j.is_tech
       JOIN skills s ON s.id = js.skill_id
      GROUP BY s.name, s.category, j.source`,
  );

  const sources: SourceTotals[] = totals.rows.map((r) => ({ source: r.source, jobs: r.jobs, techJobs: r.tech_jobs }));
  const techBySource = new Map(sources.map((s) => [s.source, s.techJobs]));

  const bySkill = new Map<string, SkillShare>();
  for (const row of counts.rows) {
    const entry = bySkill.get(row.skill) ?? { skill: row.skill, category: row.category, total: 0, bySource: {} };
    const tech = techBySource.get(row.source) ?? 0;
    entry.bySource[row.source] = { count: row.cnt, pct: tech > 0 ? round1((100 * row.cnt) / tech) : 0 };
    entry.total += row.cnt;
    bySkill.set(row.skill, entry);
  }

  return { sources, skills: [...bySkill.values()] };
}

export type SortMode = "balanced" | "total" | (string & {});

const pctOf = (s: SkillShare, source: string) => s.bySource[source]?.pct ?? 0;

/**
 * Ordena las skills.
 *  - "balanced" (por defecto): media de los porcentajes de las fuentes con suficientes ofertas, dándole el mismo
 *    peso a cada fuente. Una fuente con pocas ofertas no distorsiona el resultado ni se ignora de la tabla.
 *  - "total": por número absoluto de ofertas (lo domina la fuente más grande).
 *  - cualquier nombre de fuente: por el % en esa fuente.
 */
export function rankSkills(
  data: SkillShares,
  sort: SortMode = "balanced",
  minTechJobs: number = DEFAULT_MIN_TECH_JOBS,
): SkillShare[] {
  const byName = (a: SkillShare, b: SkillShare) => a.skill.localeCompare(b.skill);
  const known = new Set(data.sources.map((s) => s.source));

  if (sort !== "balanced" && sort !== "total") {
    if (!known.has(sort)) throw new Error(`Fuente desconocida '${sort}'. Disponibles: ${[...known].join(", ") || "(ninguna)"}`);
    return [...data.skills].sort((a, b) => pctOf(b, sort) - pctOf(a, sort) || b.total - a.total || byName(a, b));
  }

  const reliable = data.sources.filter((s) => s.techJobs >= minTechJobs).map((s) => s.source);
  if (sort === "total" || reliable.length === 0) {
    return [...data.skills].sort((a, b) => b.total - a.total || byName(a, b));
  }
  const mean = (s: SkillShare) => reliable.reduce((sum, src) => sum + pctOf(s, src), 0) / reliable.length;
  return [...data.skills].sort((a, b) => mean(b) - mean(a) || b.total - a.total || byName(a, b));
}

export interface SkillDifference {
  skill: string;
  pctA: number;
  pctB: number;
  /** pctA - pctB, en puntos porcentuales. */
  diff: number;
  countA: number;
  countB: number;
}

export interface SourceComparison {
  a: string;
  b: string;
  /** Más típicas de la fuente A que de la B. */
  moreInA: SkillDifference[];
  /** Más típicas de la fuente B que de la A. */
  moreInB: SkillDifference[];
}

/**
 * ¿Piden cosas distintas la fuente A y la B? Ordena por la diferencia en puntos porcentuales. Las skills con muy
 * pocas menciones entre ambas (`minMentions`) se descartan: 1 de 3 ofertas es 33 % y no significa nada.
 */
export function compareSources(
  data: SkillShares,
  a: string,
  b: string,
  options: { limit?: number; minMentions?: number } = {},
): SourceComparison {
  const { limit = 10, minMentions = 5 } = options;
  const known = data.sources.map((s) => s.source);
  for (const name of [a, b]) {
    if (!known.includes(name)) throw new Error(`Fuente desconocida '${name}'. Disponibles: ${known.join(", ") || "(ninguna)"}`);
  }

  const diffs: SkillDifference[] = data.skills
    .map((s) => ({
      skill: s.skill,
      pctA: pctOf(s, a),
      pctB: pctOf(s, b),
      diff: round1(pctOf(s, a) - pctOf(s, b)),
      countA: s.bySource[a]?.count ?? 0,
      countB: s.bySource[b]?.count ?? 0,
    }))
    .filter((d) => d.countA + d.countB >= minMentions);

  return {
    a,
    b,
    moreInA: diffs.filter((d) => d.diff > 0).sort((x, y) => y.diff - x.diff || x.skill.localeCompare(y.skill)).slice(0, limit),
    moreInB: diffs.filter((d) => d.diff < 0).sort((x, y) => x.diff - y.diff || x.skill.localeCompare(y.skill)).slice(0, limit),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Formato de texto para la consola
// ---------------------------------------------------------------------------------------------------------------

const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

function renderRows(headers: string[], rows: string[][], rightAlignFrom = 1): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i >= rightAlignFrom ? padL(c, widths[i]!) : pad(c, widths[i]!))).join("  ");
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

export function formatSkillTable(
  data: SkillShares,
  skills: SkillShare[],
  options: { minTechJobs?: number } = {},
): string {
  const { minTechJobs = DEFAULT_MIN_TECH_JOBS } = options;
  const small = data.sources.filter((s) => s.techJobs < minTechJobs);

  const headers = [
    "Tecnología",
    "Ofertas",
    ...data.sources.map((s) => `${s.source}${s.techJobs < minTechJobs ? "*" : ""} (${s.techJobs})`),
  ];
  const rows = skills.map((s) => [
    s.skill,
    String(s.total),
    ...data.sources.map((src) => (s.bySource[src.source] ? `${s.bySource[src.source]!.pct.toFixed(1)}%` : "-")),
  ]);

  const parts = [
    "Porcentaje de las ofertas tecnológicas de cada fuente que mencionan la tecnología (entre paréntesis, cuántas ofertas tecnológicas tiene la fuente).",
    "",
    renderRows(headers, rows),
  ];
  if (small.length > 0) {
    parts.push("", `* Menos de ${minTechJobs} ofertas tecnológicas: muestra pequeña, no cuenta en el orden "balanced".`);
  }
  return parts.join("\n");
}

export function formatComparison(cmp: SourceComparison): string {
  const sign = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
  const table = (items: SkillDifference[]) =>
    items.length === 0
      ? "  (sin diferencias con suficientes menciones)"
      : renderRows(
          ["Tecnología", `${cmp.a} %`, `${cmp.b} %`, "Diferencia (pp)"],
          items.map((d) => [d.skill, `${d.pctA.toFixed(1)}%`, `${d.pctB.toFixed(1)}%`, sign(d.diff)]),
        );

  return [
    `Más típicas de '${cmp.a}' que de '${cmp.b}':`,
    table(cmp.moreInA),
    "",
    `Más típicas de '${cmp.b}' que de '${cmp.a}':`,
    table(cmp.moreInB),
    "",
    "pp = puntos porcentuales. Se omiten tecnologías con muy pocas menciones entre las dos fuentes.",
  ].join("\n");
}
