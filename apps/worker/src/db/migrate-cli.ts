import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";
import { runMigrations } from "./migrate.js";
import { logger } from "../lib/logger.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

try {
  const applied = await runMigrations(pool);
  logger.info(applied.length ? "Migraciones completadas" : "Base de datos al día", { applied });
} catch (err) {
  logger.error("Error al migrar", { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
} finally {
  await pool.end();
}
