import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeArbeitnowJob, normalizeJobType } from "../src/normalize/arbeitnow.js";
import { fetchArbeitnowJobs, parseArbeitnowPage } from "../src/sources/arbeitnow.js";

const load = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8"));
const page1 = load("arbeitnow-page1.json");
const page2 = load("arbeitnow-page2.json");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noSleep = async () => undefined;

describe("parseArbeitnowPage", () => {
  it("separa válidas de inválidas y lee el enlace a la siguiente página", () => {
    const page = parseArbeitnowPage(page1);
    expect(page.jobs).toHaveLength(3);
    expect(page.invalid).toBe(1); // la 5004 no trae url
    expect(page.next).toBe("https://www.arbeitnow.com/api/job-board-api?page=2");
  });

  it("la última página no tiene 'next'", () => {
    expect(parseArbeitnowPage(page2).next).toBeNull();
  });

  it("tolera campos ausentes o nulos", () => {
    const page = parseArbeitnowPage({
      data: [{ slug: "x", title: "T", url: "https://www.arbeitnow.com/jobs/x", tags: null, job_types: null, remote: null }],
    });
    expect(page.jobs[0]).toMatchObject({ tags: [], job_types: [], remote: false, location: null, created_at: null });
  });

  it("lanza un error claro si falta 'data'", () => {
    expect(() => parseArbeitnowPage({ foo: 1 })).toThrow(/data/);
  });
});

describe("normalizeArbeitnowJob", () => {
  const page = parseArbeitnowPage(page1);
  const normalize = (slug: string) => {
    const i = page.jobs.findIndex((j) => j.slug === slug);
    return normalizeArbeitnowJob(page.jobs[i]!, page.rawJobs[i]);
  };

  it("mapea los campos al formato común", () => {
    expect(normalize("senior-backend-engineer-berlin-5001")).toMatchObject({
      source: "arbeitnow",
      externalId: "senior-backend-engineer-berlin-5001",
      company: "Beispiel GmbH",
      category: "Software Development",
      tags: ["Software Development"],
      jobType: "full_time",
      location: "Berlin",
      isRemote: false,
      salaryMin: null,
      url: "https://www.arbeitnow.com/jobs/companies/beispiel-gmbh/senior-backend-engineer-berlin-5001",
    });
  });

  it("convierte el timestamp Unix (segundos) en fecha", () => {
    expect(normalize("senior-backend-engineer-berlin-5001").postedAt?.toISOString()).toBe(
      new Date(1793000000 * 1000).toISOString(),
    );
  });

  it("convierte la descripción HTML en texto plano", () => {
    const d = normalize("senior-backend-engineer-berlin-5001").description!;
    expect(d).toContain("Docker & Terraform");
    expect(d).not.toMatch(/<[a-z]/i);
  });

  it("trata ubicación vacía como null y respeta remote", () => {
    expect(normalize("frontend-developer-remote-5003")).toMatchObject({ location: null, isRemote: true, category: null });
  });

  it("normaliza tipos de empleo en alemán e inglés", () => {
    expect(normalizeJobType(["Vollzeit"])).toBe("full_time");
    expect(normalizeJobType(["Teilzeit"])).toBe("part_time");
    expect(normalizeJobType(["full time"])).toBe("full_time");
    expect(normalizeJobType(["Minijob"])).toBe("minijob");
    expect(normalizeJobType([])).toBeNull();
  });
});

describe("fetchArbeitnowJobs", () => {
  it("recorre las páginas, pausa entre ellas y deduplica por slug", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return json(urls.length === 1 ? page1 : page2);
    });
    const delays: number[] = [];

    const result = await fetchArbeitnowJobs({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => void delays.push(ms),
      pageDelayMs: 1234,
    });

    expect(urls).toEqual([
      "https://www.arbeitnow.com/api/job-board-api",
      "https://www.arbeitnow.com/api/job-board-api?page=2",
    ]);
    expect(delays).toEqual([1234]);
    expect(result.pages).toBe(2);
    expect(result.invalid).toBe(1);
    // 3 válidas en la página 1 + 2 en la 2, de las cuales una repetida => 4 únicas
    expect(result.jobs.map((j) => j.slug).sort()).toEqual([
      "data-engineer-wien-5005",
      "frontend-developer-remote-5003",
      "kundenberater-muenchen-5002",
      "senior-backend-engineer-berlin-5001",
    ]);
    expect(result.rawJobs).toHaveLength(result.jobs.length);
  });

  it("respeta maxPages", async () => {
    const fetchImpl = vi.fn(async () => json(page1));
    const result = await fetchArbeitnowJobs({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      maxPages: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.pages).toBe(1);
  });

  it("ante un 429 a mitad del recorrido conserva lo descargado", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(page1))
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }));

    const result = await fetchArbeitnowJobs({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });
    expect(result.pages).toBe(1);
    expect(result.jobs).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // y no reintenta el 429
  });

  it("un 429 en la primera página sí es un error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    await expect(
      fetchArbeitnowJobs({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("no sigue enlaces de paginación hacia otros dominios", async () => {
    const evil = { ...(page1 as object), links: { next: "https://evil.example.com/api?page=2" } };
    const fetchImpl = vi.fn(async () => json(evil));
    const result = await fetchArbeitnowJobs({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.pages).toBe(1);
  });
});
