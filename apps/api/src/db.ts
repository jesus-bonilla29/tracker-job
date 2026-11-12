import pg from "pg";
import { logger } from "./logger.js";

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Una consulta pesada no debe poder acaparar la base de datos: se corta a los 10 s.
    statement_timeout: 10_000,
  });
  pool.on("error", (err) => logger.error("Error en cliente inactivo de pg", { error: err.message }));
  return pool;
}
