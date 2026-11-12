import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import type { Router } from "express";
import type pg from "pg";
import { fromZod } from "./errors.js";
import { errorResponse, z } from "./schemas.js";

export interface RouteContext {
  pool: pg.Pool;
}

/**
 * Una sola definición por endpoint sirve para TRES cosas, de modo que nunca se desincronizan:
 *   1. validar y convertir los parámetros de la petición (query y path) con Zod,
 *   2. generar la documentación OpenAPI/Swagger,
 *   3. (en pruebas) comprobar que la respuesta real cumple el esquema documentado.
 */
export interface RouteSpec<Q extends z.ZodObject, P extends z.ZodObject, R extends z.ZodTypeAny> {
  /** Ruta al estilo OpenAPI, sin el prefijo /api: "/skills/{name}/trend". */
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  query: Q;
  params: P;
  response: R;
  /** Documenta también la respuesta 404. */
  notFound?: boolean;
  handler: (input: { query: z.output<Q>; params: z.output<P> }, ctx: RouteContext) => Promise<z.input<R>>;
}

export interface RouteDeps {
  router: Router;
  registry: OpenAPIRegistry;
  ctx: RouteContext;
  /** Si es true, cada respuesta se valida contra su esquema antes de enviarse (se activa en pruebas). */
  validateResponses: boolean;
}

export function registerRoute<Q extends z.ZodObject, P extends z.ZodObject, R extends z.ZodTypeAny>(
  deps: RouteDeps,
  spec: RouteSpec<Q, P, R>,
): void {
  const errorContent = { "application/json": { schema: errorResponse } };

  deps.registry.registerPath({
    method: "get",
    path: `/api${spec.path}`,
    summary: spec.summary,
    description: spec.description,
    tags: spec.tags,
    request: { query: spec.query, params: spec.params },
    responses: {
      200: { description: "Correcto", content: { "application/json": { schema: spec.response } } },
      400: { description: "Parámetros inválidos", content: errorContent },
      ...(spec.notFound ? { 404: { description: "No encontrado", content: errorContent } } : {}),
      429: { description: "Demasiadas peticiones", content: errorContent },
      500: { description: "Error interno", content: errorContent },
      503: { description: "Base de datos no disponible", content: errorContent },
    },
  });

  // Express usa ":nombre" para los parámetros de ruta; OpenAPI usa "{nombre}".
  const expressPath = spec.path.replace(/\{(\w+)\}/g, ":$1");

  // Express 5 reenvía automáticamente al manejador de errores lo que lance (o rechace) un manejador async.
  deps.router.get(expressPath, async (req, res) => {
    const query = spec.query.safeParse(req.query);
    if (!query.success) throw fromZod(query.error, "query");
    const params = spec.params.safeParse(req.params);
    if (!params.success) throw fromZod(params.error, "path");

    const data = await spec.handler({ query: query.data, params: params.data }, deps.ctx);
    res.json(deps.validateResponses ? spec.response.parse(data) : data);
  });
}
