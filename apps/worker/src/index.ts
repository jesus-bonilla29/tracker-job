import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { runAllSources } from "./pipeline.js";
import { logger, setLogLevel } from "./lib/logger.js";

const config = loadConfig();
setLogLevel(config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL);
let timer: NodeJS.Timeout | undefined;
let stopping = false;

/** Devuelve false si alguna fuente falló. Un fallo no mata el proceso: el siguiente ciclo lo reintentará. */
async function runOnce(): Promise<boolean> {
  try {
    const { ok } = await runAllSources(pool, config);
    return ok;
  } catch (err) {
    logger.error("El ciclo de ETL falló", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info("Cerrando", { signal });
  if (timer) clearTimeout(timer);
  await pool.end();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

async function main(): Promise<void> {
  await runMigrations(pool);
  const ok = await runOnce();

  if (config.RUN_ONCE) {
    // En modo "una sola vez", el código de salida refleja si el ETL funcionó.
    process.exitCode = ok ? 0 : 1;
    await pool.end();
    return;
  }

  const intervalMs = config.ETL_INTERVAL_HOURS * 3_600_000;
  logger.info("Programador activo", { everyHours: config.ETL_INTERVAL_HOURS, sources: config.SOURCES });

  // setTimeout encadenado (no setInterval): el siguiente ciclo se agenda al terminar el anterior.
  const schedule = () => {
    timer = setTimeout(async () => {
      await runOnce();
      if (!stopping) schedule();
    }, intervalMs);
  };
  schedule();
}

main().catch(async (err) => {
  logger.error("Error fatal al iniciar", { error: err instanceof Error ? err.message : String(err) });
  await pool.end().catch(() => undefined);
  process.exit(1);
});
