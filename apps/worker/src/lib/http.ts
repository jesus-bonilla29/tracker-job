import { logger } from "./logger.js";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  /** Reintentos adicionales tras el primer intento (solo errores transitorios). */
  retries?: number;
  baseDelayMs?: number;
  headers?: Record<string, string>;
  /** Inyectable para pruebas. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 5xx y errores de red son transitorios. 4xx (incluido 429) NO se reintenta: respetamos los límites de la API. */
function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === undefined || err.status >= 500;
  return true; // fallo de red o timeout
}

export async function fetchJson(url: string, opts: FetchJsonOptions = {}): Promise<unknown> {
  const {
    timeoutMs = 20_000,
    retries = 2,
    baseDelayMs = 1_000,
    headers = {},
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new HttpError(`HTTP ${res.status} al consultar ${url}`, res.status);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isRetryable(err)) break;
      const delay = baseDelayMs * 2 ** attempt; // backoff exponencial: 1s, 2s, 4s...
      logger.warn("Petición fallida, reintentando", {
        url,
        attempt: attempt + 1,
        delayMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
