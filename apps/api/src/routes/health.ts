import { HttpError } from "../http/errors.js";
import { registerRoute, type RouteDeps } from "../http/route.js";
import { isoDateTime, none, z } from "../http/schemas.js";

const etlRun = z.object({
  source: z.string().openapi({ example: "hn" }),
  status: z.enum(["running", "ok", "error"]),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  fetched: z.number().int(),
  inserted: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
});

const health = z
  .object({
    status: z.literal("ok"),
    database: z.literal("up"),
    etl: z.array(etlRun).openapi({ description: "Última ejecución del ETL de cada fuente." }),
  })
  .openapi("Health");

export function healthRoutes(deps: RouteDeps): void {
  registerRoute(deps, {
    path: "/health",
    summary: "Estado del servicio",
    description:
      "Comprueba la conexión a la base de datos y devuelve la última ejecución del ETL de cada fuente. " +
      "Sirve para el healthcheck de Docker y para saber si los datos se están actualizando.",
    tags: ["Sistema"],
    query: none,
    params: none,
    response: health,
    handler: async (_input, { pool }) => {
      try {
        await pool.query("SELECT 1");
      } catch {
        throw new HttpError(503, "database_unavailable", "No hay conexión con la base de datos.");
      }
      const { rows } = await pool.query<{
        source: string;
        status: "running" | "ok" | "error";
        started_at: Date;
        finished_at: Date | null;
        fetched: number;
        inserted: number;
        updated: number;
        skipped: number;
      }>(
        `SELECT DISTINCT ON (source) source, status, started_at, finished_at, fetched, inserted, updated, skipped
           FROM etl_runs ORDER BY source, started_at DESC`,
      );
      return {
        status: "ok" as const,
        database: "up" as const,
        etl: rows.map((r) => ({
          source: r.source,
          status: r.status,
          startedAt: r.started_at.toISOString(),
          finishedAt: r.finished_at?.toISOString() ?? null,
          fetched: r.fetched,
          inserted: r.inserted,
          updated: r.updated,
          skipped: r.skipped,
        })),
      };
    },
  });
}
