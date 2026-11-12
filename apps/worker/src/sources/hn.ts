import { z } from "zod";
import { fetchJson, type FetchJsonOptions } from "../lib/http.js";
import { logger } from "../lib/logger.js";

/**
 * Cliente de "Ask HN: Who is hiring?" (Hacker News) a través del buscador público de Algolia. Sin API key.
 *
 *  1. `search_by_date` con `author_whoishiring` localiza los hilos mensuales (la cuenta `whoishiring`
 *     también publica "Who wants to be hired?" y "Freelancer?", que descartamos por el título).
 *  2. `items/:id` devuelve el hilo completo con sus comentarios anidados en UNA sola petición.
 *     Los comentarios de primer nivel (`children`) son las ofertas; las respuestas anidadas se ignoran.
 *
 * Cada ejecución hace 1 búsqueda + 1 petición por hilo. Los campos exactos de un ítem no están en la
 * documentación que consulté, así que el esquema tolera campos ausentes y se valida con cada comentario.
 */
export const HN_API_URL = "https://hn.algolia.com/api/v1";

const HIRING_TITLE_RE = /^ask hn:\s*who is hiring\?/i;

export const isHiringThreadTitle = (title: string | null | undefined): boolean =>
  Boolean(title && HIRING_TITLE_RE.test(title.trim()));

export interface HnThread {
  id: string;
  title: string;
  createdAt: Date;
  /** "2026-11": mes en que se publicó el hilo (UTC). */
  month: string;
}

export interface HnComment {
  id: string;
  author: string | null;
  /** HTML tal como lo entrega la API. */
  html: string;
  createdAt: Date | null;
  thread: HnThread;
}

const hitSchema = z.object({
  objectID: z.coerce.string().min(1),
  title: z.string().nullish(),
  created_at_i: z.coerce.number().int().positive().nullish(),
});

const searchSchema = z.object({ hits: z.array(z.unknown()) });

/** Hilos "Who is hiring?" encontrados en la respuesta de búsqueda, del más reciente al más antiguo. */
export function parseSearchHits(payload: unknown): HnThread[] {
  const search = searchSchema.safeParse(payload);
  if (!search.success) throw new Error("Respuesta inesperada de HN/Algolia: falta el arreglo 'hits'");

  const threads: HnThread[] = [];
  for (const item of search.data.hits) {
    const hit = hitSchema.safeParse(item);
    if (!hit.success || !isHiringThreadTitle(hit.data.title) || !hit.data.created_at_i) continue;
    const createdAt = new Date(hit.data.created_at_i * 1000);
    threads.push({
      id: hit.data.objectID,
      title: hit.data.title!.trim(),
      createdAt,
      month: createdAt.toISOString().slice(0, 7),
    });
  }
  return threads.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

const itemSchema = z.object({
  children: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? []),
});

const commentSchema = z.object({
  id: z.coerce.number().int().positive(),
  author: z.string().nullish(),
  text: z.string().nullish(),
  created_at_i: z.coerce.number().int().positive().nullish(),
});

export interface ThreadParseResult {
  comments: HnComment[];
  /** Comentarios eliminados, "dead" o con formato inesperado. */
  invalid: number;
}

/** Comentarios de primer nivel de un hilo. Los eliminados llegan sin texto y se cuentan como descartados. */
export function parseThreadItem(payload: unknown, thread: HnThread): ThreadParseResult {
  const item = itemSchema.safeParse(payload);
  if (!item.success) throw new Error("Respuesta inesperada de HN/Algolia: el hilo no tiene el formato esperado");

  const comments: HnComment[] = [];
  let invalid = 0;

  for (const child of item.data.children) {
    const parsed = commentSchema.safeParse(child);
    const html = parsed.success ? parsed.data.text?.trim() : undefined;
    if (!parsed.success || !html) {
      invalid++;
      continue;
    }
    comments.push({
      id: String(parsed.data.id),
      author: parsed.data.author ?? null,
      html,
      createdAt: parsed.data.created_at_i ? new Date(parsed.data.created_at_i * 1000) : null,
      thread,
    });
  }
  return { comments, invalid };
}

export interface FetchHnOptions extends FetchJsonOptions {
  /** Cuántos hilos mensuales recorrer, del más reciente hacia atrás (1 a 12). */
  threads?: number;
  /** Pausa entre hilos. */
  threadDelayMs?: number;
}

export interface HnResult {
  comments: HnComment[];
  invalid: number;
  threads: HnThread[];
}

export async function fetchHnComments(options: FetchHnOptions = {}): Promise<HnResult> {
  const { threads: wanted = 1, threadDelayMs = 1_000, ...httpOptions } = options;
  const sleep = httpOptions.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const headers = { "User-Agent": "tech-job-tracker/0.1 (proyecto de portafolio)", ...httpOptions.headers };

  const query = encodeURIComponent("Ask HN: Who is hiring?");
  const searchUrl = `${HN_API_URL}/search_by_date?tags=story,author_whoishiring&query=${query}&hitsPerPage=50`;
  const found = parseSearchHits(await fetchJson(searchUrl, { ...httpOptions, headers }));
  if (found.length === 0) throw new Error("No se encontró ningún hilo 'Ask HN: Who is hiring?' en HN/Algolia");

  const selected = found.slice(0, wanted);
  const comments: HnComment[] = [];
  const done: HnThread[] = [];
  let invalid = 0;

  for (const [i, thread] of selected.entries()) {
    if (i > 0) await sleep(threadDelayMs);
    try {
      // Un hilo grande pesa varios MB: damos más margen que el tiempo de espera por defecto.
      const payload = await fetchJson(`${HN_API_URL}/items/${thread.id}`, {
        timeoutMs: 60_000,
        ...httpOptions,
        headers,
      });
      const parsed = parseThreadItem(payload, thread);
      comments.push(...parsed.comments);
      invalid += parsed.invalid;
      done.push(thread);
    } catch (err) {
      // Si ya tenemos datos de hilos anteriores (histórico), seguimos con lo descargado; si es el primero, fallamos.
      if (done.length === 0) throw err;
      logger.warn("No se pudo descargar un hilo de HN; se conserva lo ya obtenido", {
        thread: thread.id,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }

  return { comments, invalid, threads: done };
}
