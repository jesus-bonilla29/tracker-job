import type pg from "pg";

export interface RunStats {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

export async function startRun(pool: pg.Pool, source: string): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO etl_runs (source) VALUES ($1) RETURNING id",
    [source],
  );
  return Number(rows[0]!.id);
}

export async function finishRun(pool: pg.Pool, runId: number, stats: RunStats): Promise<void> {
  await pool.query(
    `UPDATE etl_runs
        SET finished_at = now(), status = 'ok',
            fetched = $2, inserted = $3, updated = $4, skipped = $5
      WHERE id = $1`,
    [runId, stats.fetched, stats.inserted, stats.updated, stats.skipped],
  );
}

export async function failRun(pool: pg.Pool, runId: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await pool.query(
    "UPDATE etl_runs SET finished_at = now(), status = 'error', error = $2 WHERE id = $1",
    [runId, message.slice(0, 2000)],
  );
}

/**
 * Guarda de frecuencia: ¿se intentó consultar esta fuente hace menos de `minIntervalHours`?
 * Cuenta también las ejecuciones fallidas, para que un fallo en bucle (p. ej. Docker reiniciando el
 * contenedor) no bombardee la API de la fuente.
 * Una ejecución 'running' vieja (proceso caído) se ignora pasados 30 minutos.
 */
export async function ranRecently(pool: pg.Pool, source: string, minIntervalHours: number): Promise<Date | null> {
  const { rows } = await pool.query<{ started_at: Date }>(
    `SELECT started_at
       FROM etl_runs
      WHERE source = $1
        AND started_at > now() - make_interval(secs => $2)
        AND (status IN ('ok', 'error') OR started_at > now() - interval '30 minutes')
      ORDER BY started_at DESC
      LIMIT 1`,
    [source, minIntervalHours * 3600],
  );
  return rows[0]?.started_at ?? null;
}
