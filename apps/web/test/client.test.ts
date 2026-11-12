import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, buildQuery, getJson, seg } from "../src/api/client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("buildQuery / seg", () => {
  it("omite vacíos y codifica", () => {
    expect(buildQuery({ a: 1, b: "", c: undefined, d: null, e: false, f: "x y" })).toBe("?a=1&e=false&f=x+y");
    expect(buildQuery()).toBe("");
    expect(buildQuery({ q: undefined })).toBe("");
  });

  it("los nombres con / o + se codifican en la ruta", () => {
    expect(seg("CI/CD")).toBe("CI%2FCD");
    expect(seg("C++")).toBe("C%2B%2B");
    expect(seg("Node.js")).toBe("Node.js");
  });
});

describe("getJson", () => {
  it("devuelve el JSON y pide application/json", async () => {
    const fetchMock = vi.fn(async () => json({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getJson("/skills/top", { limit: 5 })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/skills/top?limit=5", expect.objectContaining({ headers: { Accept: "application/json" } }));
  });

  it("convierte el error de la API en ApiError con su mensaje y código", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "validation_error", message: "Parámetros inválidos" } }, 400)));
    const err = await getJson("/jobs").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "validation_error", message: "Parámetros inválidos" });
  });

  it("si el cuerpo del error no es JSON (proxy caído), da un mensaje genérico con el estado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad Gateway</html>", { status: 502 })));
    const err = (await getJson("/jobs").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/502/);
    expect(err.message).not.toMatch(/Bad Gateway/); // nunca se muestra HTML ajeno
  });

  it("sin conexión: ApiError con estado 0 y pista para el usuario", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = (await getJson("/health").catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ status: 0, code: "network" });
    expect(err.message).toMatch(/docker compose up/);
  });

  it("una cancelación (AbortError) no se disfraza de error de red", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("cancelado", "AbortError"); }));
    await expect(getJson("/health")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("respuesta 200 que no es JSON válido", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no es json", { status: 200 })));
    await expect(getJson("/health")).rejects.toMatchObject({ code: "bad_response" });
  });
});
