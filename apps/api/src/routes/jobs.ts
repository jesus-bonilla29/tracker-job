import { applyJobFilters } from "../http/filters.js";
import { notFound } from "../http/errors.js";
import { registerRoute, type RouteDeps } from "../http/route.js";
import { assertDateRange, boolParam, dateParam, isoDateTime, none, parseCsv, sourceParam, z } from "../http/schemas.js";
import { Sql } from "../http/sql.js";

export const ATTRIBUTION =
  "Datos de Remotive, Arbeitnow y Hacker News. Cada oferta enlaza (campo `url`) a su publicación original; " +
  "cualquier uso público debe mantener ese enlace y citar la fuente.";

export const jobSummary = z.object({
  id: z.number().int(),
  source: z.string().openapi({ example: "hn" }),
  title: z.string(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  isRemote: z.boolean(),
  isTech: z.boolean(),
  jobType: z.string().nullable().openapi({ example: "full_time" }),
  salaryMin: z.number().int().nullable(),
  salaryMax: z.number().int().nullable(),
  salaryCurrency: z.string().nullable(),
  postedAt: isoDateTime.nullable(),
  url: z.string().url().openapi({ description: "Enlace a la oferta original." }),
  skills: z.array(z.string()).openapi({ example: ["PostgreSQL", "React", "TypeScript"] }),
});

const listQuery = z
  .object({
    q: z.string().trim().min(1).max(100).optional().openapi({ description: "Texto a buscar en el título o la empresa." }),
    skills: z
      .string()
      .max(700)
      .optional()
      .openapi({ example: "React,TypeScript", description: "Tecnologías separadas por comas (máx. 10). La oferta debe mencionar TODAS." }),
    source: sourceParam.optional(),
    remote: boolParam.optional(),
    hasSalary: boolParam.optional().openapi({ description: "true = solo ofertas con salario conocido." }),
    includeNonTech: boolParam.optional().openapi({ description: "Por defecto solo se listan ofertas tecnológicas." }),
    from: dateParam.optional(),
    to: dateParam.optional(),
    sort: z.enum(["recent", "salary"]).default("recent"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const listResponse = z
  .object({
    attribution: z.string(),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
    data: z.array(jobSummary),
  })
  .openapi("JobList");

const detailResponse = jobSummary
  .extend({
    description: z.string().nullable(),
    tags: z.array(z.string()),
    firstSeenAt: isoDateTime,
    lastSeenAt: isoDateTime,
  })
  .openapi("JobDetail");

export interface JobRow {
  id: string;
  source: string;
  title: string;
  company: string | null;
  location: string | null;
  is_remote: boolean;
  is_tech: boolean;
  job_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  posted_at: Date | null;
  url: string;
  skills: string[];
}

export const SKILLS_SUBQUERY = `COALESCE((
  SELECT array_agg(s.name ORDER BY s.name)
    FROM job_skills js JOIN skills s ON s.id = js.skill_id
   WHERE js.job_id = j.id
), '{}')`;

export const toSummary = (r: JobRow) => ({
  id: Number(r.id), // BIGSERIAL llega como texto desde pg
  source: r.source,
  title: r.title,
  company: r.company,
  location: r.location,
  isRemote: r.is_remote,
  isTech: r.is_tech,
  jobType: r.job_type,
  salaryMin: r.salary_min,
  salaryMax: r.salary_max,
  salaryCurrency: r.salary_currency,
  postedAt: r.posted_at?.toISOString() ?? null,
  url: r.url,
  skills: r.skills,
});

/** Escapa % _ \ para que el texto del usuario se busque literalmente y no como comodines de LIKE. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

export function jobsRoutes(deps: RouteDeps): void {
  registerRoute(deps, {
    path: "/jobs",
    summary: "Buscar ofertas",
    description:
      "Lista paginada de ofertas con filtros combinables. `skills` exige que la oferta mencione todas las tecnologías indicadas " +
      "(útil para ver qué ofertas encajan con tu perfil). No incluye la descripción completa: usa `/jobs/{id}`.",
    tags: ["Ofertas"],
    query: listQuery,
    params: none,
    response: listResponse,
    handler: async ({ query }, { pool }) => {
      assertDateRange(query.from, query.to);
      const wanted = parseCsv(query.skills);

      const sql = new Sql();
      applyJobFilters(sql, {
        source: query.source,
        from: query.from,
        to: query.to,
        remote: query.remote,
        includeNonTech: query.includeNonTech,
      });
      if (query.q) {
        const like = likePattern(query.q);
        sql.where(`(j.title ILIKE ? ESCAPE '\\' OR j.company ILIKE ? ESCAPE '\\')`, like, like);
      }
      if (query.hasSalary) sql.where("(j.salary_min IS NOT NULL OR j.salary_max IS NOT NULL)");
      for (const name of wanted) {
        sql.where(
          `EXISTS (SELECT 1 FROM job_skills js JOIN skills s ON s.id = js.skill_id WHERE js.job_id = j.id AND lower(s.name) = lower(?))`,
          name,
        );
      }

      const total = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM jobs j ${sql.whereSql}`, sql.values)).rows[0]?.n ?? 0;

      const order =
        query.sort === "salary"
          ? "j.salary_max DESC NULLS LAST, j.posted_at DESC NULLS LAST, j.id DESC"
          : "j.posted_at DESC NULLS LAST, j.id DESC";
      const limit = sql.bind(query.pageSize);
      const offset = sql.bind((query.page - 1) * query.pageSize);

      const { rows } = await pool.query<JobRow>(
        `SELECT j.id, j.source, j.title, j.company, j.location, j.is_remote, j.is_tech, j.job_type,
                j.salary_min, j.salary_max, j.salary_currency, j.posted_at, j.url,
                ${SKILLS_SUBQUERY} AS skills
           FROM jobs j
           ${sql.whereSql}
          ORDER BY ${order}
          LIMIT ${limit} OFFSET ${offset}`,
        sql.values,
      );

      return {
        attribution: ATTRIBUTION,
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
        data: rows.map(toSummary),
      };
    },
  });

  registerRoute(deps, {
    path: "/jobs/{id}",
    summary: "Detalle de una oferta",
    description: "Incluye la descripción completa (texto plano) y las etiquetas de la fuente.",
    tags: ["Ofertas"],
    query: none,
    params: z.object({ id: z.coerce.number().int().min(1).max(2_147_483_647).openapi({ example: 42 }) }),
    response: detailResponse,
    notFound: true,
    handler: async ({ params }, { pool }) => {
      const { rows } = await pool.query<
        JobRow & { description: string | null; tags: string[] | null; first_seen_at: Date; last_seen_at: Date }
      >(
        `SELECT j.id, j.source, j.title, j.company, j.location, j.is_remote, j.is_tech, j.job_type,
                j.salary_min, j.salary_max, j.salary_currency, j.posted_at, j.url,
                j.description, j.tags, j.first_seen_at, j.last_seen_at,
                ${SKILLS_SUBQUERY} AS skills
           FROM jobs j WHERE j.id = $1`,
        [params.id],
      );
      const row = rows[0];
      if (!row) throw notFound(`No existe la oferta ${params.id}.`);
      return {
        ...toSummary(row),
        description: row.description,
        tags: row.tags ?? [],
        firstSeenAt: row.first_seen_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
      };
    },
  });
}
