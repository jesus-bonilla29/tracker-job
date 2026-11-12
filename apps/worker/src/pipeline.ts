import type pg from "pg";
import { MIN_INTERVAL_HOURS, type Config, type SourceName } from "./config.js";
import { failRun, finishRun, ranRecently, startRun } from "./db/etl-runs.js";
import { upsertJobs } from "./db/jobs.js";
import { syncSkills } from "./db/skills.js";
import { enrichJob } from "./enrich.js";
import { createSkillExtractor, loadSkillDefinitions, type SkillExtractor } from "./extract/skills.js";
import { logger } from "./lib/logger.js";
import { createSource, type Source } from "./sources/index.js";

export type RunOutcome =
  | { status: "skipped"; lastRun: Date }
  | { status: "ok"; fetched: number; inserted: number; updated: number; skipped: number }
  | { status: "error"; error: string };

export interface Enrichment {
  extract: SkillExtractor;
  skillIds: Map<string, number>;
}

/** Carga el catálogo de skills, lo sincroniza con la base de datos y compila el extractor. */
export async function prepareEnrichment(pool: pg.Pool, skillsFile?: string): Promise<Enrichment> {
  const definitions = await loadSkillDefinitions(skillsFile);
  const skillIds = await syncSkills(pool, definitions);
  return { extract: createSkillExtractor(definitions), skillIds };
}

/** ETL de UNA fuente: extraer -> normalizar -> enriquecer (skills, relevancia) -> guardar. */
export async function runSourceEtl(
  pool: pg.Pool,
  config: Pick<Config, "FORCE_RUN">,
  source: Source,
  enrichment: Enrichment,
): Promise<RunOutcome> {
  if (!config.FORCE_RUN) {
    const last = await ranRecently(pool, source.name, MIN_INTERVAL_HOURS);
    if (last) {
      logger.info("Se omite la ejecución: la fuente se consultó hace poco", {
        source: source.name,
        lastRun: last.toISOString(),
        minIntervalHours: MIN_INTERVAL_HOURS,
      });
      return { status: "skipped", lastRun: last };
    }
  }

  const runId = await startRun(pool, source.name);
  try {
    const { jobs, invalid } = await source.fetch();
    const enriched = jobs.map((job) => enrichJob(job, enrichment.extract));
    const { inserted, updated } = await upsertJobs(pool, enriched, enrichment.skillIds);

    const stats = { fetched: jobs.length + invalid, inserted, updated, skipped: invalid };
    await finishRun(pool, runId, stats);
    logger.info("ETL completado", {
      source: source.name,
      runId,
      ...stats,
      techJobs: enriched.filter((e) => e.isTech).length,
    });
    return { status: "ok", ...stats };
  } catch (err) {
    await failRun(pool, runId, err);
    throw err;
  }
}

/** Ejecuta todas las fuentes configuradas. El fallo de una NO impide que corran las demás. */
export async function runAllSources(
  pool: pg.Pool,
  config: Config,
  enrichment?: Enrichment,
  /** Inyectable para pruebas (así no se toca la red). */
  sourceFactory: (name: SourceName, config: Config) => Source = createSource,
): Promise<{ ok: boolean; outcomes: Record<string, RunOutcome> }> {
  const ctx = enrichment ?? (await prepareEnrichment(pool));
  const outcomes: Record<string, RunOutcome> = {};

  for (const name of config.SOURCES) {
    try {
      outcomes[name] = await runSourceEtl(pool, config, sourceFactory(name, config), ctx);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("El ETL de una fuente falló", { source: name, error });
      outcomes[name] = { status: "error", error };
    }
  }

  return { ok: Object.values(outcomes).every((o) => o.status !== "error"), outcomes };
}
