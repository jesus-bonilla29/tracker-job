import { describe, expect, it, vi } from "vitest";
import { fetchJson, HttpError } from "../src/lib/http.js";

const noSleep = async () => undefined;
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

describe("fetchJson", () => {
  it("reintenta ante un 5xx y termina bien", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(ok());

    const data = await fetchJson("https://example.test", { fetchImpl: fetchImpl as typeof fetch, sleep: noSleep });
    expect(data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("NO reintenta ante un 429 (respeta los límites de la API)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));

    await expect(
      fetchJson("https://example.test", { fetchImpl: fetchImpl as typeof fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ name: "HttpError", status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reintenta ante errores de red y se rinde tras agotar los reintentos", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      fetchJson("https://example.test", { fetchImpl: fetchImpl as typeof fetch, sleep: noSleep, retries: 2 }),
    ).rejects.toThrow("fetch failed");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("usa backoff exponencial entre intentos", async () => {
    const delays: number[] = [];
    const fetchImpl = vi.fn().mockResolvedValue(new Response("err", { status: 500 }));

    await expect(
      fetchJson("https://example.test", {
        fetchImpl: fetchImpl as typeof fetch,
        sleep: async (ms) => void delays.push(ms),
        retries: 3,
        baseDelayMs: 100,
      }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(delays).toEqual([100, 200, 400]);
  });
});
