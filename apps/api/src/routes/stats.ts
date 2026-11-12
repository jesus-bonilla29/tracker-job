import { registerRoute, type RouteDeps } from "../http/route.js";
import { isoDateTime, none, z } from "../http/schemas.js";

const overview = z
  .object({
    totals: z.object({
      jobs: z.number().int(),
      techJobs: z.number().int(),
      sources: z.number().int(),
      skillsInCatalog: z.number().int(),
    }),
    sources: z.array(
      z.object({
        source: z.string().openapi({ example: "arbeitnow" }),
        jobs: z.number().int(),
        techJobs: z.number().int(),
        latestPostedAt: isoDateTime.nullable(),
        newLast24h: z.number().int().openapi({ description: "Ofertas vistas por primera vez en las últimas 24 horas." }),
      }),
    ),
  })
  .openapi("Overview");

export function statsRoutes(deps: RouteDeps): void {
  registerRoute(deps, {
    path: "/stats/overview",
    summary: "Resumen general",
    description: "Totales de ofertas y de ofertas tecnológicas, por fuente, y cuántas aparecieron en las últimas 24 horas.",
    tags: ["Estadísticas"],
    query: none,
    params: none,
    response: overview,
    handler: async (_input, { pool }) => {
      const [{ rows }, skills] = await Promise.all([
        pool.query<{ source: string; jobs: number; tech_jobs: number; latest: Date | null; new_24h: number }>(
          `SELECT source,
                  count(*)::int                                                   AS jobs,
                  (count(*) FILTER (WHERE is_tech))::int                          AS tech_jobs,
                  max(posted_at)                                                  AS latest,
                  (count(*) FILTER (WHERE first_seen_at > now() - interval '24 hours'))::int AS new_24h
             FROM jobs GROUP BY source ORDER BY source`,
        ),
        pool.query<{ n: number }>("SELECT count(*)::int AS n FROM skills"),
      ]);

      return {
        totals: {
          jobs: rows.reduce((n, r) => n + r.jobs, 0),
          techJobs: rows.reduce((n, r) => n + r.tech_jobs, 0),
          sources: rows.length,
          skillsInCatalog: skills.rows[0]?.n ?? 0,
        },
        sources: rows.map((r) => ({
          source: r.source,
          jobs: r.jobs,
          techJobs: r.tech_jobs,
          latestPostedAt: r.latest?.toISOString() ?? null,
          newLast24h: r.new_24h,
        })),
      };
    },
  });
}
