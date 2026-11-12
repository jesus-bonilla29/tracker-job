import { z } from "zod";
import { fetchJson, HttpError, type FetchJsonOptions } from "../lib/http.js";
import { logger } from "../lib/logger.js";

/**
 * Cliente de la API pública de Arbeitnow (ofertas de Europa y remotas). No requiere API key.
 * Referencia: https://www.arbeitnow.com/blog/job-board-api
 *
 * Su documentación oficial no publica límites, pero la API responde 429 si se recorre rápido.
 * Por eso: pausa entre páginas, tope de páginas y, si llega un 429 a mitad del recorrido,
 * nos quedamos con lo ya descargado en vez de fallar. Conservamos siempre el enlace a la oferta original.
 */
export const ARBEITNOW_API_URL = "https://www.arbeitnow.com/api/job-board-api";

const optionalText = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

export const arbeitnowJobSchema = z.object({
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
  company_name: optionalText,
  description: optionalText,
  remote: z.boolean().nullish().transform((v) => v ?? false),
  url: z.string().url(),
  tags: z.array(z.string()).nullish().transform((v) => v ?? []),
  job_types: z.array(z.string()).nullish().transform((v) => v ?? []),
  location: optionalText,
  /** Timestamp Unix en segundos. */
  created_at: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
});

export type ArbeitnowJob = z.infer<typeof arbeitnowJobSchema>;

const pageSchema = z.object({
  data: z.array(z.unknown()),
  links: z.object({ next: z.string().nullish() }).partial().nullish(),
});

export interface ArbeitnowPage {
  jobs: ArbeitnowJob[];
  rawJobs: unknown[];
  invalid: number;
  next: string | null;
}

export function parseArbeitnowPage(payload: unknown): ArbeitnowPage {
  const page = pageSchema.safeParse(payload);
  if (!page.success) throw new Error("Respuesta inesperada de Arbeitnow: falta el arreglo 'data'");

  const jobs: ArbeitnowJob[] = [];
  const rawJobs: unknown[] = [];
  let invalid = 0;

  for (const item of page.data.data) {
    const parsed = arbeitnowJobSchema.safeParse(item);
    if (parsed.success) {
      jobs.push(parsed.data);
      rawJobs.push(item);
    } else {
      invalid++;
      logger.warn("Oferta de Arbeitnow descartada por datos inválidos", {
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
  }

  return { jobs, rawJobs, invalid, next: page.data.links?.next ?? null };
}

/** Solo seguimos enlaces de paginación que apunten a arbeitnow.com por HTTPS. */
function isTrustedNextUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && (u.hostname === "arbeitnow.com" || u.hostname.endsWith(".arbeitnow.com"));
  } catch {
    return false;
  }
}

export interface FetchArbeitnowOptions extends FetchJsonOptions {
  maxPages?: number;
  pageDelayMs?: number;
}

export interface ArbeitnowResult {
  jobs: ArbeitnowJob[];
  rawJobs: unknown[];
  invalid: number;
  pages: number;
}

export async function fetchArbeitnowJobs(options: FetchArbeitnowOptions = {}): Promise<ArbeitnowResult> {
  const { maxPages = 5, pageDelayMs = 1_500, ...httpOptions } = options;
  const sleep = httpOptions.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const bySlug = new Map<string, { job: ArbeitnowJob; raw: unknown }>(); // el feed puede desplazarse mientras lo recorremos
  let invalid = 0;
  let pages = 0;
  let url: string | null = ARBEITNOW_API_URL;

  while (url && pages < maxPages) {
    let payload: unknown;
    try {
      payload = await fetchJson(url, {
        ...httpOptions,
        headers: { "User-Agent": "tech-job-tracker/0.1 (proyecto de portafolio)", ...httpOptions.headers },
      });
    } catch (err) {
      if (pages > 0 && err instanceof HttpError && err.status === 429) {
        logger.warn("Arbeitnow limitó las peticiones (429); se conserva lo descargado", { pages });
        break;
      }
      throw err;
    }

    const page = parseArbeitnowPage(payload);
    pages++;
    invalid += page.invalid;
    page.jobs.forEach((job, i) => bySlug.set(job.slug, { job, raw: page.rawJobs[i] }));

    if (!page.next) break;
    if (!isTrustedNextUrl(page.next)) {
      logger.warn("Enlace de paginación no confiable; se detiene el recorrido", { next: page.next });
      break;
    }
    url = page.next;
    if (pages < maxPages) await sleep(pageDelayMs);
  }

  const entries = [...bySlug.values()];
  return { jobs: entries.map((e) => e.job), rawJobs: entries.map((e) => e.raw), invalid, pages };
}
