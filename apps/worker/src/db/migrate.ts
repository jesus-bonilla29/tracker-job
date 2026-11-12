import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { logger } from "../lib/logger.js";

/** apps/worker/{src|dist}/db  ->  raíz del repo  ->  db/migrations */
export const DEFAULT_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../../../db/migrations");

/**
 * Ejecuta en orden los archivos .sql pendientes. Cada migración corre dentro de una transacción
 * y se registra en `schema_migrations`, así que es seguro llamarla en cada arranque.
 */
export async function runMigrations(pool: pg.Pool, dir: string = DEFAULT_MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    // Evita que dos procesos migren a la vez.
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const done = new Set(
      (await client.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename),
    );

    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
        logger.info("Migración aplicada", { file });
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Falló la migración ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => undefined);
    client.release();
  }

  return applied;
}
