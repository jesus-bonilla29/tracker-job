import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./lib/logger.js";
import { prepareEnrichment } from "./pipeline.js";
import { reprocessJobs } from "./reprocess.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

try {
  await runMigrations(pool);
  const result = await reprocessJobs(pool, await prepareEnrichment(pool));
  logger.info("Reprocesamiento completado", result);
} catch (err) {
  logger.error("Error al reprocesar", { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
} finally {
  await pool.end();
}
