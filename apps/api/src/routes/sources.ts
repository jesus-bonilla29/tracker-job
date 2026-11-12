import { pct, round1 } from "../http/filters.js";
import { badRequest, notFound } from "../http/errors.js";
import { registerRoute, type RouteDeps } from "../http/route.js";
import { limitParam, none, sourceParam, z } from "../http/schemas.js";

const compareQuery = z
  .object({
    a: sourceParam.openapi({ example: "hn" }),
    b: sourceParam.openapi({ example: "arbeitnow" }),
    limit: limitParam(10, 30),
    minMentions: z.coerce.number().int().min(1).max(1000).default(3).openapi({
      description: "Descarta tecnologías con menos menciones entre las dos fuentes (con pocas ofertas, un % grande no significa nada).",
    }),
  })
  .strict();

const diff = z.object({
  name: z.string().openapi({ example: "React" }),
  pctA: z.number(),
  pctB: z.number(),
  diff: z.number().openapi({ description: "pctA - pctB, en puntos porcentuales." }),
  jobsA: z.number().int(),
  jobsB: z.number().int(),
});

const compareResponse = z
  .object({
    a: z.object({ source: z.string(), techJobs: z.number().int() }),
    b: z.object({ source: z.string(), techJobs: z.number().int() }),
    moreInA: z.array(diff).openapi({ description: "Más típicas de la fuente A que de la B." }),
    moreInB: z.array(diff).openapi({ description: "Más típicas de la fuente B que de la A." }),
    note: z.string(),
  })
  .openapi("SourceComparison");

export function sourcesRoutes(deps: RouteDeps): void {
  registerRoute(deps, {
    path: "/sources/compare",
    summary: "Comparar dos fuentes",
    description:
      "¿Qué tecnologías se piden más en una fuente que en otra? Cada tecnología se expresa como % de las ofertas tecnológicas " +
      "de su fuente, así que el tamaño de las fuentes no distorsiona la comparación. Diferencias de pocos puntos con pocas " +
      "ofertas son ruido; y las fuentes difieren en estilo de anuncio (los de Hacker News son cortos), no solo en demanda.",
    tags: ["Estadísticas"],
    query: compareQuery,
    params: none,
    response: compareResponse,
    notFound: true,
    handler: async ({ query }, { pool }) => {
      if (query.a === query.b) throw badRequest("'a' y 'b' deben ser fuentes distintas");
      const pair = [query.a, query.b];

      const totals = await pool.query<{ source: string; tech: number }>(
        `SELECT source, (count(*) FILTER (WHERE is_tech))::int AS tech FROM jobs WHERE source = ANY($1::text[]) GROUP BY source`,
        [pair],
      );
      const tech = new Map(totals.rows.map((r) => [r.source, r.tech]));
      for (const s of pair) {
        if (!tech.has(s)) {
          const known = (await pool.query<{ source: string }>("SELECT DISTINCT source FROM jobs ORDER BY source")).rows.map((r) => r.source);
          throw notFound(`No hay ofertas de la fuente '${s}'. Disponibles: ${known.join(", ") || "(ninguna)"}.`);
        }
      }

      const { rows } = await pool.query<{ name: string; source: string; c: number }>(
        `SELECT s.name, j.source, count(*)::int AS c
           FROM job_skills js
           JOIN jobs j   ON j.id = js.job_id AND j.is_tech AND j.source = ANY($1::text[])
           JOIN skills s ON s.id = js.skill_id
          GROUP BY s.name, j.source`,
        [pair],
      );

      const techA = tech.get(query.a)!;
      const techB = tech.get(query.b)!;
      const byName = new Map<string, { a: number; b: number }>();
      for (const r of rows) {
        const entry = byName.get(r.name) ?? { a: 0, b: 0 };
        if (r.source === query.a) entry.a = r.c;
        else entry.b = r.c;
        byName.set(r.name, entry);
      }

      const diffs = [...byName.entries()]
        .filter(([, v]) => v.a + v.b >= query.minMentions)
        .map(([name, v]) => ({
          name,
          pctA: pct(v.a, techA),
          pctB: pct(v.b, techB),
          diff: round1(pct(v.a, techA) - pct(v.b, techB)),
          jobsA: v.a,
          jobsB: v.b,
        }));

      return {
        a: { source: query.a, techJobs: techA },
        b: { source: query.b, techJobs: techB },
        moreInA: diffs.filter((d) => d.diff > 0).sort((x, y) => y.diff - x.diff || x.name.localeCompare(y.name)).slice(0, query.limit),
        moreInB: diffs.filter((d) => d.diff < 0).sort((x, y) => x.diff - y.diff || x.name.localeCompare(y.name)).slice(0, query.limit),
        note: "pctA y pctB son % de las ofertas tecnológicas de cada fuente. diff en puntos porcentuales.",
      };
    },
  });
}
