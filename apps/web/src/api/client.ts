/** Error de la API (o de red) con un mensaje que se puede mostrar tal cual al usuario. */
export class ApiError extends Error {
  constructor(
    readonly status: number, // 0 = no hubo respuesta (red caída, API apagada)
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Params = Record<string, string | number | boolean | undefined | null>;

const BASE = import.meta.env.VITE_API_URL ?? "";

export function buildQuery(params: Params = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** Los nombres de tecnología llevan caracteres como "/" o "+" ("CI/CD", "C++"): hay que codificarlos en la ruta. */
export const seg = (value: string): string => encodeURIComponent(value);

export async function getJson<T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}${buildQuery(params)}`, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network", "No se pudo conectar con la API. Comprueba que esté en marcha (docker compose up).");
  }

  if (!res.ok) {
    let code = "http_error";
    let message = `La API respondió con el error ${res.status}.`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // cuerpo no JSON (p. ej. un proxy caído): nos quedamos con el mensaje genérico
    }
    throw new ApiError(res.status, code, message);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, "bad_response", "La API devolvió una respuesta que no se puede leer.");
  }
}
