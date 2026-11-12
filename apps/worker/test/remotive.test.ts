import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRemotiveJob } from "../src/normalize/remotive.js";
import { fetchRemotiveJobs, parseRemotiveResponse } from "../src/sources/remotive.js";

const fixture: unknown = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures/remotive.json"), "utf8"),
);

describe("parseRemotiveResponse", () => {
  it("separa ofertas válidas de inválidas sin lanzar error", () => {
    const { jobs, invalid, rawJobs } = parseRemotiveResponse(fixture);
    expect(jobs).toHaveLength(4);
    expect(invalid).toBe(1); // la oferta 1004 no trae url
    expect(rawJobs).toHaveLength(jobs.length);
  });

  it("convierte textos vacíos en null", () => {
    const { jobs } = parseRemotiveResponse(fixture);
    const frontend = jobs.find((j) => j.id === 1002)!;
    expect(frontend.job_type).toBeNull();
    expect(frontend.salary).toBeNull();
    expect(frontend.company_logo).toBeNull();
  });

  it("lanza un error claro si la respuesta no tiene 'jobs'", () => {
    expect(() => parseRemotiveResponse({ foo: "bar" })).toThrow(/jobs/);
    expect(() => parseRemotiveResponse(null)).toThrow();
  });
});

describe("normalizeRemotiveJob", () => {
  const { jobs, rawJobs } = parseRemotiveResponse(fixture);
  const normalize = (id: number) => {
    const i = jobs.findIndex((j) => j.id === id);
    return normalizeRemotiveJob(jobs[i]!, rawJobs[i]);
  };

  it("mapea los campos al formato común", () => {
    const job = normalize(1001);
    expect(job).toMatchObject({
      source: "remotive",
      externalId: "1001",
      title: "Senior TypeScript Engineer",
      company: "Acme Cloud",
      isRemote: true,
      location: "Worldwide",
      salaryMin: 90_000,
      salaryMax: 120_000,
      salaryCurrency: "USD",
      url: "https://remotive.com/remote-jobs/software-dev/senior-typescript-engineer-1001",
    });
  });

  it("convierte la descripción HTML en texto plano", () => {
    const description = normalize(1001).description!;
    expect(description).toContain("Node.js & TypeScript");
    expect(description).toContain("• React on the frontend");
    expect(description).not.toMatch(/<[a-z]/i);
  });

  it("trata la fecha sin zona horaria como UTC", () => {
    expect(normalize(1001).postedAt?.toISOString()).toBe("2026-11-05T10:23:26.000Z");
  });

  it("no inventa salarios cuando la tarifa es por hora o está vacía", () => {
    expect(normalize(1003)).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null });
    expect(normalize(1002)).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null });
  });

  it("conserva el objeto original en raw", () => {
    expect((normalize(1005).raw as { id: number }).id).toBe(1005);
  });
});

describe("fetchRemotiveJobs", () => {
  it("construye la URL con la categoría y valida la respuesta", async () => {
    let requested = "";
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      requested = String(input);
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as typeof fetch;

    const result = await fetchRemotiveJobs({ category: "software-dev", fetchImpl });
    expect(requested).toBe("https://remotive.com/api/remote-jobs?category=software-dev");
    expect(result.jobs).toHaveLength(4);
  });
});
