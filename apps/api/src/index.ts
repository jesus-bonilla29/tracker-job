import { createApp } from "./app.js";
import { loadConfig, parseCorsOrigins } from "./config.js";
import { createPool } from "./db.js";
import { logger } from "./logger.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

const app = createApp({
  pool,
  corsOrigins: parseCorsOrigins(config.CORS_ORIGIN),
  rateLimitPerMin: config.RATE_LIMIT_PER_MIN,
  cacheSeconds: config.CACHE_SECONDS,
  trustProxy: config.TRUST_PROXY,
});

const server = app.listen(config.PORT, "0.0.0.0", () => {
  logger.info("API escuchando", { port: config.PORT, docs: `/api/docs` });
});

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  logger.info("Cerrando", { signal });
  // Deja de aceptar conexiones, termina las que están en curso y cierra el pool.
  server.close(() => void pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref(); // si algo se cuelga, salimos igualmente
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
