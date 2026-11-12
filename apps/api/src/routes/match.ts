import { applyJobFilters, pct } from "../http/filters.js";
import { badRequest } from "../http/errors.js";
import { registerRoute, type RouteDeps } from "../http/route.js";
import { assertDateRange, boolParam, dateParam, none, parseCsv, sourceParam, z } from "../http/schemas.js";
import { Sql } from "../http/sql.js";
import { ATTRIBUTION, SKILLS_SUBQUERY, jobSummary, toSummary, type JobRow } from "./jobs.js";

const MAX_SKILLS = 30;

const matchQuery = z
  .object({
    skills: z
      .string()
      .min(1)
      .max(1500)
      .openapi({ example: "React,TypeScript,Node.js", description: `Tecnologías que ya conoces, separadas por comas (máx. ${MAX_SKILLS}). Sin distinguir mayúsculas.` }),
    source: sourceParam.optional(),
    remote: boolParam.optional(),
    from: dateParam.optional(),
    to: dateParam.optional(),
    minSkills: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .openapi({ description: "Se ignoran las ofertas con menos tecnologías detectadas que esto: con 1 de 1 el 100 % no significa nada." }),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

const category = z.string().nullable();

const matchResponse = z
  .object({
    attribution: z.string(),
    profile: z.object({
      skills: z.array(z.string()).openapi({ description: "Tecnologías reconocidas, con el nombre del catálogo." }),
      unknown: z.array(z.string()).openapi({ description: "Nombres que no están en el catálogo y se ignoran." }),
    }),
    summary: z
      .object({
        considered: z.number().int().openapi({ description: "Ofertas tecnológicas con al menos `minSkills` tecnologías detectadas." }),
        withAnyMatch: z.number().int(),
        atLeast50: z.number().int().openapi({ description: "Ofertas en las que ya tienes la mitad o más de lo que piden." }),
        atLeast75: z.number().int(),
        full: z.number().int().openapi({ description: "Ofertas en las que ya tienes todo lo que piden." }),
      })
      .openapi({ description: "Cuántas ofertas caen en cada tramo de encaje (acumulativo: 'full' está dentro de 'atLeast75')." }),
    learnNext: z
      .array(
        z.object({
          name: z.string(),
          category,
          unlocks: z.number().int().openapi({ description: "Ofertas en las que esta es la ÚNICA tecnología que te falta: aprenderla te da un encaje del 100 %." }),
          closeJobs: z.number().int().openapi({ description: "Ofertas en las que ya tienes al menos la mitad y que piden esta tecnología." }),
        }),
      )
      .openapi({ description: "Qué aprender después, de más a menos rentable." }),
    jobs: z.array(
      jobSummary.extend({
        matched: z.array(z.string()).openapi({ description: "Lo que piden y ya tienes." }),
        missing: z.array(z.string()).openapi({ description: "Lo que piden y te falta." }),
        coverage: z.number().openapi({ description: "% de las tecnologías de la oferta que ya tienes.", example: 66.7 }),
      }),
    ),
  })
  .openapi("MatchResult");

export function matchRoutes(deps: RouteDeps): void {
  registerRoute(deps, {
    path: "/match",
    summary: "Ofertas que encajan con tus tecnologías",
    description:
      "Para cada oferta tecnológica calcula qué parte de las tecnologías que pide ya conoces (`coverage`) y las ordena de " +
      "mayor a menor encaje. También sugiere qué aprender después (`learnNext`).\n\n" +
      "**Cómo leerlo:** es un cruce de listas de tecnologías, no una evaluación de tu perfil: no mide nivel ni experiencia, y " +
      "las tecnologías de cada oferta se detectan automáticamente a partir de su texto. Los anuncios largos (p. ej. Arbeitnow) " +
      "mencionan más tecnologías y por eso tienden a tener un encaje menor que los cortos (Hacker News); usa `source` para " +
      "compararlos entre iguales.",
    tags: ["Mi match"],
    query: matchQuery,
    params: none,
    response: matchResponse,
    handler: async ({ query }, { pool }) => {
      assertDateRange(query.from, query.to);
      const requested = [...new Set(parseCsv(query.skills, MAX_SKILLS).map((s) => s.toLowerCase()))];
      if (requested.length === 0) throw badRequest("Indica al menos una tecnología.");

      // 1) Resolver los nombres contra el catálogo (sin distinguir mayúsculas).
      const known = (
        await pool.query<{ name: string }>("SELECT name FROM skills WHERE lower(name) = ANY($1::text[]) ORDER BY name", [requested])
      ).rows.map((r) => r.name);
      const knownLower = new Set(known.map((n) => n.toLowerCase()));
      const unknown = requested.filter((n) => !knownLower.has(n));

      const empty = { attribution: ATTRIBUTION, profile: { skills: known, unknown }, summary: { considered: 0, withAnyMatch: 0, atLeast50: 0, atLeast75: 0, full: 0 }, learnNext: [], jobs: [] };
      if (known.length === 0) return empty;

      // 2) Por oferta: cuántas tecnologías pide (`required`) y cuántas de ellas conoces (`matched`).
      //    Se construye una vez por consulta porque cada una numera sus propios parámetros ($1, $2...).
      const withPerJob = () => {
        const sql = new Sql();
        const pNames = sql.bind(known.map((n) => n.toLowerCase()));
        applyJobFilters(sql, { source: query.source, from: query.from, to: query.to, remote: query.remote });
        const pMin = sql.bind(query.minSkills);
        const text = `
          WITH profile AS (SELECT id FROM skills WHERE lower(name) = ANY(${pNames}::text[])),
          per_job AS (
            SELECT j.id,
                   count(*)::int AS required,
                   (count(*) FILTER (WHERE js.skill_id IN (SELECT id FROM profile)))::int AS matched
              FROM jobs j
              JOIN job_skills js ON js.job_id = j.id
              ${sql.whereSql}
             GROUP BY j.id
            HAVING count(*) >= ${pMin}
          )`;
        return { sql, text };
      };

      const s = withPerJob();
      const { rows: sumRows } = await pool.query<{ considered: number; with_match: number; half: number; high: number; full: number }>(
        `${s.text}
         SELECT count(*)::int AS considered,
                (count(*) FILTER (WHERE matched > 0))::int AS with_match,
                (count(*) FILTER (WHERE matched * 2 >= required))::int AS half,
                (count(*) FILTER (WHERE matched * 4 >= required * 3))::int AS high,
                (count(*) FILTER (WHERE matched = required))::int AS full
           FROM per_job`,
        s.sql.values,
      );
      const sum = sumRows[0] ?? { considered: 0, with_match: 0, half: 0, high: 0, full: 0 };

      // 3) Las mejores ofertas: mayor porcentaje, luego más tecnologías en común, luego más recientes.
      const t = withPerJob();
      const pLimit = t.sql.bind(query.limit);
      const { rows: jobRows } = await pool.query<JobRow>(
        `${t.text}
         SELECT j.*, ${SKILLS_SUBQUERY} AS skills
           FROM per_job pj
           JOIN jobs j ON j.id = pj.id
          WHERE pj.matched > 0
          ORDER BY pj.matched::numeric / pj.required DESC, pj.matched DESC, j.posted_at DESC NULLS LAST, j.id DESC
          LIMIT ${pLimit}`,
        t.sql.values,
      );

      // 4) Qué aprender: entre las ofertas que ya cubres a medias o más (y no del todo), qué tecnología falta más.
      const l = withPerJob();
      const { rows: learnRows } = await pool.query<{ name: string; category: string | null; close_jobs: number; solo: number }>(
        `${l.text}
         SELECT s.name, s.category,
                count(*)::int AS close_jobs,
                (count(*) FILTER (WHERE pj.required - pj.matched = 1))::int AS solo
           FROM per_job pj
           JOIN job_skills js ON js.job_id = pj.id AND js.skill_id NOT IN (SELECT id FROM profile)
           JOIN skills s ON s.id = js.skill_id
          WHERE pj.matched * 2 >= pj.required AND pj.matched < pj.required
          GROUP BY s.name, s.category
          ORDER BY solo DESC, close_jobs DESC, s.name ASC
          LIMIT 8`,
        l.sql.values,
      );

      return {
        attribution: ATTRIBUTION,
        profile: { skills: known, unknown },
        summary: { considered: sum.considered, withAnyMatch: sum.with_match, atLeast50: sum.half, atLeast75: sum.high, full: sum.full },
        learnNext: learnRows.map((r) => ({ name: r.name, category: r.category, unlocks: r.solo, closeJobs: r.close_jobs })),
        jobs: jobRows.map((row) => {
          const job = toSummary(row);
          const matched = job.skills.filter((n) => knownLower.has(n.toLowerCase()));
          const missing = job.skills.filter((n) => !knownLower.has(n.toLowerCase()));
          return { ...job, matched, missing, coverage: pct(matched.length, job.skills.length) };
        }),
      };
    },
  });
}
