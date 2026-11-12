import { z } from "zod";
import { fetchJson, type FetchJsonOptions } from "../lib/http.js";
import { logger } from "../lib/logger.js";

/**
 * Cliente de la API pública de Remotive.
 * Documentación: https://github.com/remotive-com/remote-jobs-api
 *
 * Reglas de uso que respetamos:
 *  - Máximo 4 peticiones al día (más de 2 por minuto se bloquean).
 *  - Las ofertas llegan con 24 h de retraso.
 *  - Hay que enlazar a la oferta original y citar a Remotive como fuente.
 *  - No se deben enviar ofertas de Remotive a sitios de terceros.
 */
export const REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs";

/** Campos opcionales y a veces vacíos: los toleramos para no perder ofertas por detalles. */
const optionalText = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

export const remotiveJobSchema = z.object({
  id: z.coerce.number().int().positive(),
  url: z.string().url(),
  title: z.string().trim().min(1),
  company_name: optionalText,
  company_logo: optionalText,
  category: optionalText,
  job_type: optionalText,
  publication_date: optionalText,
  candidate_required_location: optionalText,
  salary: optionalText,
  description: optionalText,
});

export type RemotiveJob = z.infer<typeof remotiveJobSchema>;

/** Solo validamos la "envoltura"; cada oferta se valida por separado (ver parseRemotiveResponse). */
const envelopeSchema = z.object({
  jobs: z.array(z.unknown()),
});

export interface RemotiveParseResult {
  jobs: RemotiveJob[];
  /** Ofertas que no pasaron la validación; se cuentan y se registran, pero no tumban la ejecución. */
  invalid: number;
  /** Objetos originales de cada oferta válida (misma posición que `jobs`), guardados luego en la columna `raw`. */
  rawJobs: unknown[];
}

export function parseRemotiveResponse(payload: unknown): RemotiveParseResult {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new Error("Respuesta inesperada de Remotive: falta el arreglo 'jobs'");
  }

  const jobs: RemotiveJob[] = [];
  const rawJobs: unknown[] = [];
  let invalid = 0;

  for (const item of envelope.data.jobs) {
    const parsed = remotiveJobSchema.safeParse(item);
    if (parsed.success) {
      jobs.push(parsed.data);
      rawJobs.push(item);
    } else {
      invalid++;
      logger.warn("Oferta de Remotive descartada por datos inválidos", {
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
  }

  return { jobs, invalid, rawJobs };
}

export interface FetchRemotiveOptions extends FetchJsonOptions {
  category?: string;
  limit?: number;
}

export async function fetchRemotiveJobs(options: FetchRemotiveOptions = {}): Promise<RemotiveParseResult> {
  const { category, limit, ...httpOptions } = options;
  const url = new URL(REMOTIVE_API_URL);
  if (category) url.searchParams.set("category", category);
  if (limit) url.searchParams.set("limit", String(limit));

  const payload = await fetchJson(url.toString(), {
    ...httpOptions,
    headers: { "User-Agent": "tech-job-tracker/0.1 (proyecto de portafolio)", ...httpOptions.headers },
  });

  return parseRemotiveResponse(payload);
}
