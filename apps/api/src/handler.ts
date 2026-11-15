// Entrada para Vercel (funciones serverless): exporta la app de Express como manejador (req, res).
// En servidores con proceso propio (Docker) se sigue usando index.ts.
import { createApp } from "./app.js";
import { loadConfig, parseCorsOrigins } from "./config.js";
import { createPool } from "./db.js";

const config = loadConfig();
// Cada instancia serverless tiene su propio pool: pocas conexiones y timeout en el cliente (compatible con el pooler de Neon).
const pool = createPool(config.DATABASE_URL, { max: 3, clientSideTimeout: true });

export default createApp({
  pool,
  corsOrigins: parseCorsOrigins(config.CORS_ORIGIN),
  rateLimitPerMin: config.RATE_LIMIT_PER_MIN,
  cacheSeconds: config.CACHE_SECONDS,
  trustProxy: config.TRUST_PROXY,
});
