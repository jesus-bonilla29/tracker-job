import pg from "pg";
import { logger } from "./logger.js";

export interface PoolOptions {
  /** Conexiones máximas. En serverless (cada instancia tiene su pool) usa un valor bajo. */
  max?: number;
  /**
   * true = el timeout de consulta lo aplica el cliente (query_timeout). Necesario con pools de conexiones externos
   * (p. ej. el pooler de Neon), que rechazan el parámetro de arranque statement_timeout.
   */
  clientSideTimeout?: boolean;
}

export function createPool(connectionString: string, opts: PoolOptions = {}): pg.Pool {
  const timeoutMs = 10_000;
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    // Una consulta pesada no debe poder acaparar la base de datos: se corta a los 10 s.
    ...(opts.clientSideTimeout ? { query_timeout: timeoutMs } : { statement_timeout: timeoutMs }),
  });
  pool.on("error", (err) => logger.error("Error en cliente inactivo de pg", { error: err.message }));
  return pool;
}
