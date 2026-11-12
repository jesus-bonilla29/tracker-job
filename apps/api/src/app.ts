import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import cors from "cors";
import express, { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type pg from "pg";
import swaggerUi from "swagger-ui-express";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import type { RouteDeps } from "./http/route.js";
import { buildOpenApi } from "./openapi.js";
import { healthRoutes } from "./routes/health.js";
import { jobsRoutes } from "./routes/jobs.js";
import { matchRoutes } from "./routes/match.js";
import { skillsRoutes } from "./routes/skills.js";
import { sourcesRoutes } from "./routes/sources.js";
import { statsRoutes } from "./routes/stats.js";

export interface AppOptions {
  pool: pg.Pool;
  corsOrigins: string[] | "*";
  /** 0 = sin límite. */
  rateLimitPerMin: number;
  cacheSeconds: number;
  /** Nº de proxies de confianza delante de la API (ver TRUST_PROXY en config.ts). 0 = ninguno. */
  trustProxy?: number;
  /** Valida cada respuesta contra su esquema documentado. Actívalo en pruebas. */
  validateResponses?: boolean;
}

/** Los datos cambian como mucho cada pocas horas: dejamos que navegadores y proxies cacheen. El estado, nunca. */
const cacheControl = (seconds: number): RequestHandler => (req, res, next) => {
  res.set("Cache-Control", req.path === "/health" || seconds === 0 ? "no-store" : `public, max-age=${seconds}`);
  next();
};

export function createApp(opts: AppOptions): express.Express {
  const registry = new OpenAPIRegistry();
  const router = Router();
  const deps: RouteDeps = { router, registry, ctx: { pool: opts.pool }, validateResponses: opts.validateResponses ?? false };

  for (const register of [healthRoutes, statsRoutes, skillsRoutes, jobsRoutes, matchRoutes, sourcesRoutes]) register(deps);
  const spec = buildOpenApi(registry);

  const app = express();
  app.disable("x-powered-by");
  if (opts.trustProxy) app.set("trust proxy", opts.trustProxy);

  // La documentación va ANTES de helmet: Swagger UI usa scripts en línea que la política CSP de helmet bloquearía.
  // Es una página estática de solo lectura y no maneja datos del usuario.
  app.get("/api/openapi.json", (_req, res) => res.json(spec));
  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(spec as unknown as Record<string, unknown>, { customSiteTitle: "Tech Job Tracker API" }),
  );

  app.use(helmet());

  app.use(
    cors({
      origin:
        opts.corsOrigins === "*"
          ? "*"
          : (origin, callback) => callback(null, !origin || opts.corsOrigins.includes(origin)),
      methods: ["GET", "HEAD", "OPTIONS"],
      maxAge: 600,
    }),
  );

  if (opts.rateLimitPerMin > 0) {
    app.use(
      "/api",
      rateLimit({
        windowMs: 60_000,
        limit: opts.rateLimitPerMin,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        handler: (_req, res) => {
          res.status(429).json({ error: { code: "rate_limited", message: "Demasiadas peticiones. Espera un minuto." } });
        },
      }),
    );
  }

  app.use("/api", cacheControl(opts.cacheSeconds), router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
