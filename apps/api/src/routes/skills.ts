import type pg from "pg";
import { applyJobFilters, pct } from "../http/filters.js";
import { notFound } from "../http/errors.js";
import { registerRoute, type RouteDeps } from "../http/route.js";
import { assertDateRange, dateParam, limitParam, none, sourceParam, z } from "../http/schemas.js";
import { Sql } from "../http/sql.js";

const category = z.string().nullable().openapi({ example: "language" });

const skillRef = z.object({ name: z.string().openapi({ example: "TypeScript" }), category });

async function findSkill(pool: pg.Pool, name: string): Promise<{ id: number; name: string; category: string | null }> {
  // Comparación sin distinguir mayúsculas: /skills/typescript/trend funciona igual que /skills/TypeScript/trend.
  const { rows } = await pool.query<{ id: number; name: string; category: string | null }>(
    "SELECT id, name, category FROM skills WHERE lower(name) = lower($1)",
    [name],
  );
  const skill = rows[0];
  if (!skill) throw notFound(`No existe la tecnología '${name}' en el catálogo.`);
  return skill;
}

const nameParam = z.object({
  name: z.string().min(1).max(60).openapi({ example: "TypeScript", description: "Nombre de la tecnología (sin distinguir mayúsculas)." }),
});

const topQuery = z
  .object({
    source: sourceParam.optional(),
    category: z.string().min(1).max(40).optional().openapi({ example: "language", description: "language, framework, database, cloud..." }),
    from: dateParam.optional().openapi({ description: "Fecha de publicación mínima (AAAA-MM-DD).", example: "2026-10-01" }),
    to: dateParam.optional().openapi({ description: "Fecha de publicación máxima (AAAA-MM-DD).", example: "2026-11-30" }),
    limit: limitParam(20, 100),
  })
  .strict();

const topResponse = z
  .object({
    totalJobs: z.number().int().openapi({ description: "Ofertas tecnológicas que cumplen los filtros (el 100 % del porcentaje)." }),
    skills: z.array(
      z.object({
        name: z.string().openapi({ example: "Python" }),
        category,
        jobs: z.number().int(),
        pct: z.number().openapi({ description: "% de las ofertas filtradas que mencionan la tecnología.", example: 35.7 }),
      }),
    ),
  })
  .openapi("TopSkills");

const trendQuery = z
  .object({
    interval: z.enum(["week", "month"]).default("month"),
    source: sourceParam.optional(),
    from: dateParam.optional(),
    to: dateParam.optional(),
  })
  .strict();

const trendResponse = z
  .object({
    skill: skillRef,
    interval: z.enum(["week", "month"]),
    series: z
      .array(
        z.object({
          period: z.string().openapi({ example: "2026-11-01", description: "Primer día del periodo (lunes si es semanal), en UTC." }),
          jobs: z.number().int().openapi({ description: "Ofertas tecnológicas publicadas en el periodo." }),
          mentions: z.number().int().openapi({ description: "De ellas, las que mencionan la tecnología." }),
          pct: z.number(),
        }),
      )
      .openapi({ description: "Solo incluye periodos con al menos una oferta. Excluye ofertas sin fecha de publicación." }),
  })
  .openapi("SkillTrend");

const coQuery = z.object({ source: sourceParam.optional(), limit: limitParam(15, 50) }).strict();

const coResponse = z
  .object({
    skill: skillRef,
    jobsWithSkill: z.number().int(),
    related: z.array(
      z.object({
        name: z.string(),
        category,
        jobs: z.number().int().openapi({ description: "Ofertas que mencionan ambas tecnologías." }),
        pct: z.number().openapi({ description: "% de las ofertas con la tecnología consultada que también mencionan esta." }),
      }),
    ),
  })
  .openapi("SkillCooccurrence");

export function skillsRoutes(deps: RouteDeps): void {
  registerRoute(deps, {
    path: "/skills/top",
    summary: "Tecnologías más pedidas",
    description:
      "Ranking de tecnologías entre las ofertas tecnológicas que cumplen los filtros. El porcentaje se calcula sobre " +
      "ese mismo conjunto, así que es comparable entre fuentes de tamaños distintos (usa `source` para compararlas).",
    tags: ["Tecnologías"],
    query: topQuery,
    params: none,
    response: topResponse,
    handler: async ({ query }, { pool }) => {
      assertDateRange(query.from, query.to);
      const sql = new Sql();
      applyJobFilters(sql, { source: query.source, from: query.from, to: query.to });

      // El denominador es el total de ofertas filtradas; el filtro de categoría solo afecta a qué filas se listan.
      const total = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM jobs j ${sql.whereSql}`, sql.values))
        .rows[0]?.n ?? 0;

      if (query.category) sql.where("s.category = ?", query.category);
      const limit = sql.bind(query.limit);
      const { rows } = await pool.query<{ name: string; category: string | null; jobs: number }>(
        `SELECT s.name, s.category, count(*)::int AS jobs
           FROM jobs j
           JOIN job_skills js ON js.job_id = j.id
           JOIN skills s      ON s.id = js.skill_id
           ${sql.whereSql}
          GROUP BY s.name, s.category
          ORDER BY jobs DESC, s.name ASC
          LIMIT ${limit}`,
        sql.values,
      );

      return { totalJobs: total, skills: rows.map((r) => ({ name: r.name, category: r.category, jobs: r.jobs, pct: pct(r.jobs, total) })) };
    },
  });

  registerRoute(deps, {
    path: "/skills/{name}/trend",
    summary: "Evolución de una tecnología en el tiempo",
    description:
      "Para cada semana o mes: cuántas ofertas tecnológicas se publicaron y cuántas mencionan la tecnología. " +
      "Se agrupa por la fecha de publicación de la oferta (no por cuándo se descargó), por lo que el histórico cargado " +
      "de golpe desde Hacker News también dibuja tendencia.",
    tags: ["Tecnologías"],
    query: trendQuery,
    params: nameParam,
    response: trendResponse,
    notFound: true,
    handler: async ({ query, params }, { pool }) => {
      assertDateRange(query.from, query.to);
      const skill = await findSkill(pool, params.name);

      const sql = new Sql();
      const pInterval = sql.bind(query.interval);
      const pSkill = sql.bind(skill.id);
      sql.where("j.posted_at IS NOT NULL");
      applyJobFilters(sql, { source: query.source, from: query.from, to: query.to });

      const { rows } = await pool.query<{ period: string; jobs: number; mentions: number }>(
        `SELECT to_char(date_trunc(${pInterval}::text, j.posted_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
                count(*)::int AS jobs,
                (count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM job_skills js WHERE js.job_id = j.id AND js.skill_id = ${pSkill}
                )))::int AS mentions
           FROM jobs j
           ${sql.whereSql}
          GROUP BY 1
          ORDER BY 1`,
        sql.values,
      );

      return {
        skill: { name: skill.name, category: skill.category },
        interval: query.interval,
        series: rows.map((r) => ({ period: r.period, jobs: r.jobs, mentions: r.mentions, pct: pct(r.mentions, r.jobs) })),
      };
    },
  });

  registerRoute(deps, {
    path: "/skills/{name}/cooccurrence",
    summary: "Tecnologías que se piden junto a otra",
    description: "Entre las ofertas tecnológicas que mencionan la tecnología consultada, qué otras tecnologías aparecen con más frecuencia.",
    tags: ["Tecnologías"],
    query: coQuery,
    params: nameParam,
    response: coResponse,
    notFound: true,
    handler: async ({ query, params }, { pool }) => {
      const skill = await findSkill(pool, params.name);

      const sql = new Sql();
      const pSkill = sql.bind(skill.id);
      applyJobFilters(sql, { source: query.source });
      sql.where(`EXISTS (SELECT 1 FROM job_skills own WHERE own.job_id = j.id AND own.skill_id = ${pSkill})`);

      const total = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM jobs j ${sql.whereSql}`, sql.values))
        .rows[0]?.n ?? 0;

      const limit = sql.bind(query.limit);
      const { rows } = await pool.query<{ name: string; category: string | null; jobs: number }>(
        `SELECT s.name, s.category, count(*)::int AS jobs
           FROM jobs j
           JOIN job_skills js ON js.job_id = j.id AND js.skill_id <> ${pSkill}
           JOIN skills s      ON s.id = js.skill_id
           ${sql.whereSql}
          GROUP BY s.name, s.category
          ORDER BY jobs DESC, s.name ASC
          LIMIT ${limit}`,
        sql.values,
      );

      return {
        skill: { name: skill.name, category: skill.category },
        jobsWithSkill: total,
        related: rows.map((r) => ({ name: r.name, category: r.category, jobs: r.jobs, pct: pct(r.jobs, total) })),
      };
    },
  });
}
