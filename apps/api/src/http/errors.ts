import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../logger.js";

export interface ErrorDetail {
  path: string;
  message: string;
}

/** Error con código HTTP propio: el manejador lo convierte en una respuesta JSON coherente. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (message: string) => new HttpError(404, "not_found", message);
export const badRequest = (message: string, details?: ErrorDetail[]) =>
  new HttpError(400, "validation_error", message, details);

export function fromZod(error: ZodError, where: string): HttpError {
  const details = error.issues.map((i) => ({ path: i.path.join(".") || where, message: i.message }));
  return badRequest(`Parámetros inválidos (${where})`, details);
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(404).json({ error: { code: "not_found", message: `Ruta no encontrada: ${req.method} ${req.path}` } });
};

/** Códigos de pg que significan "la base de datos no puede atender ahora" (no es un fallo del cliente). */
const DB_NOT_READY = new Set(["42P01"]); // la tabla aún no existe: el worker no ha migrado
const DB_TIMEOUT = "57014"; // statement_timeout

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Un error (400, 404, 503...) no debe quedarse cacheado aunque la ruta normalmente sí lo permita.
  res.set("Cache-Control", "no-store");

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  const meta = typeof err === "object" && err !== null ? (err as { code?: unknown; status?: unknown }) : {};

  // Errores del cliente que detecta Express antes de llegar a nuestras rutas (p. ej. "%E0%A4%A" mal codificado):
  // traen su propio status 4xx. Son culpa de la petición, no del servidor.
  if (typeof meta.status === "number" && meta.status >= 400 && meta.status < 500) {
    res.status(meta.status).json({ error: { code: "bad_request", message: "Petición mal formada." } });
    return;
  }

  const code = meta.code;

  if (typeof code === "string" && DB_NOT_READY.has(code)) {
    res.status(503).json({
      error: { code: "database_not_ready", message: "La base de datos todavía no está lista. Reintenta en unos segundos." },
    });
    return;
  }
  if (code === DB_TIMEOUT) {
    res.status(503).json({ error: { code: "query_timeout", message: "La consulta tardó demasiado. Prueba con filtros más acotados." } });
    return;
  }

  // Cualquier otro fallo: se registra completo en el servidor y NUNCA se filtra al cliente.
  logger.error("Error no controlado", {
    method: req.method,
    path: req.path,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ error: { code: "internal_error", message: "Error interno del servidor." } });
};
