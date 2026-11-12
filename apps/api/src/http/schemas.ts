import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { badRequest } from "./errors.js";

extendZodWithOpenApi(z);
export { z };

/** Fuente: ofertas de 'remotive', 'arbeitnow' o 'hn'. Patrón estricto: nunca llega texto arbitrario al SQL. */
export const sourceParam = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,30}$/, "Nombre de fuente inválido")
  .openapi({ example: "hn", description: "Fuente: remotive, arbeitnow o hn." });

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // rechaza 2026-02-31
};

export const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD")
  .refine(isRealDate, "La fecha no existe en el calendario");

export const boolParam = z.enum(["true", "false"]).transform((v) => v === "true");

export const limitParam = (def: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(def).openapi({ example: def });

/** El rango de fechas debe tener sentido (se comprueba aparte porque `.refine` en el objeto rompería la documentación). */
export function assertDateRange(from?: string, to?: string): void {
  if (from && to && from > to) throw badRequest("'from' no puede ser posterior a 'to'");
}

/** Acepta "React,TypeScript" y devuelve la lista limpia; máx. 10 elementos de hasta 60 caracteres. */
export function parseCsv(raw: string | undefined, max = 10): string[] {
  if (!raw) return [];
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (items.length > max) throw badRequest(`Máximo ${max} valores separados por comas`);
  if (items.some((s) => s.length > 60)) throw badRequest("Cada valor puede tener como máximo 60 caracteres");
  return items;
}

export const isoDateTime = z.string().datetime();

export const errorResponse = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "validation_error" }),
      message: z.string(),
      details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    }),
  })
  .openapi("ErrorResponse");

export const none = z.object({}).strict();
