import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { ranRecently } from "../src/db/etl-runs.js";
import { upsertJobs } from "../src/db/jobs.js";
import { runMigrations } from "../src/db/migrate.js";
import { enrichJob } from "../src/enrich.js";
import { normalizeArbeitnowJob } from "../src/normalize/arbeitnow.js";
import { normalizeHnComment } from "../src/normalize/hn.js";
import { normalizeRemotiveJob } from "../src/normalize/remotive.js";
import { prepareEnrichment, runAllSources, runSourceEtl, type Enrichment } from "../src/pipeline.js";
import { getSkillShares } from "../src/report.js";
import { reprocessJobs } from "../src/reprocess.js";
import { parseArbeitnowPage } from "../src/sources/arbeitnow.js";
import { parseThreadItem, type HnThread } from "../src/sources/hn.js";
import type { Source } from "../src/sources/index.js";
import { parseRemotiveResponse } from "../src/sources/remotive.js";

/**
 * Pruebas de integración contra PostgreSQL real (nunca tocan la red: las fuentes son simuladas).
 * Solo corren si defines TEST_DATABASE_URL (en CI se levanta un servicio de Postgres).
 * ¡Usa una base de datos de pruebas: estas pruebas BORRAN el esquema public!
 */
const url = process.env.TEST_DATABASE_URL;

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8"));

const remotive = parseRemotiveResponse(fixture("remotive.json"));
const arbeitnow = parseArbeitnowPage(fixture("arbeitnow-page1.json"));

const remotiveSource: Source = {
  name: "remotive",
  fetch: async () => ({
    jobs: remotive.jobs.map((j, i) => normalizeRemotiveJob(j, remotive.rawJobs[i])),
    invalid: remotive.invalid,
  }),
};
const arbeitnowSource: Source = {
  name: "arbeitnow",
  fetch: async () => ({
    jobs: arbeitnow.jobs.map((j, i) => normalizeArbeitnowJob(j, arbeitnow.rawJobs[i])),
    invalid: arbeitnow.invalid,
  }),
};
const hnThread: HnThread = {
  id: "9000003",
  title: "Ask HN: Who is hiring? (November 2026)",
  createdAt: new Date("2026-11-02T15:01:00Z"),
  month: "2026-11",
};
const hn = parseThreadItem(fixture("hn-thread.json"), hnThread);
const hnSource: Source = {
  name: "hn",
  fetch: async () => {
    const jobs = hn.comments.flatMap((c) => normalizeHnComment(c) ?? []);
    return { jobs, invalid: hn.invalid + (hn.comments.length - jobs.length) }; // misma lógica que sources/index.ts
  },
};
const failingSource: Source = {
  name: "arbeitnow",
  fetch: async () => {
    throw new Error("API caída");
  },
};

const config = (over: Partial<Config> = {}) => ({ FORCE_RUN: true, SOURCES: ["remotive", "arbeitnow"], ...over }) as Config;

describe.skipIf(!url)("integración con PostgreSQL", () => {
  let pool: pg.Pool;
  let enrichment: Enrichment;

  const skillsOf = async (source: string, externalId: string): Promise<string[]> => {
    const { rows } = await pool.query<{ name: string }>(
      `SELECT s.name FROM job_skills js
         JOIN skills s ON s.id = js.skill_id
         JOIN jobs j ON j.id = js.job_id
        WHERE j.source = $1 AND j.external_id = $2
        ORDER BY s.name`,
      [source, externalId],
    );
    return rows.map((r) => r.name);
  };
  const isTech = async (source: string, externalId: string): Promise<boolean> =>
    (await pool.query("SELECT is_tech FROM jobs WHERE source=$1 AND external_id=$2", [source, externalId])).rows[0].is_tech;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    expect(await runMigrations(pool)).toEqual(["001_init.sql", "002_tags_and_relevance.sql"]);
    enrichment = await prepareEnrichment(pool);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE jobs, etl_runs RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("las migraciones son idempotentes y el catálogo de skills se carga", async () => {
    expect(await runMigrations(pool)).toEqual([]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM skills");
    expect(rows[0].n).toBeGreaterThan(80);
    // Sincronizar de nuevo no duplica
    await prepareEnrichment(pool);
    expect((await pool.query("SELECT count(*)::int AS n FROM skills")).rows[0].n).toBe(rows[0].n);
  });

  it("Remotive: guarda ofertas con sus skills y su marca is_tech", async () => {
    const outcome = await runSourceEtl(pool, config(), remotiveSource, enrichment);
    expect(outcome).toEqual({ status: "ok", fetched: 5, inserted: 4, updated: 0, skipped: 1 });

    expect(await skillsOf("remotive", "1001")).toEqual(["Node.js", "PostgreSQL", "React", "Redis", "TypeScript"]);
    expect(await skillsOf("remotive", "1005")).toEqual(["AWS", "Docker", "Kubernetes", "Terraform"]);
    expect(await isTech("remotive", "1001")).toBe(true);

    const { rows } = await pool.query(
      "SELECT salary_min, salary_max, salary_currency FROM jobs WHERE external_id = '1001'",
    );
    expect(rows[0]).toEqual({ salary_min: 90000, salary_max: 120000, salary_currency: "USD" });
  });

  it("HN: guarda ofertas de texto libre, descarta lo que no es oferta y es idempotente", async () => {
    const outcome = await runSourceEtl(pool, config(), hnSource, enrichment);
    // 11 comentarios de primer nivel: 1 eliminado + 1 comentario de meta descartados => 9 ofertas.
    expect(outcome).toEqual({ status: "ok", fetched: 11, inserted: 9, updated: 0, skipped: 2 });

    expect(await skillsOf("hn", "9100001")).toEqual(
      expect.arrayContaining(["AWS", "Node.js", "PostgreSQL", "React", "TypeScript"]),
    );
    expect(await isTech("hn", "9100001")).toBe(true);
    expect(await isTech("hn", "9100010")).toBe(false); // Account Executive: no es tecnología
    expect(await skillsOf("hn", "9100010")).not.toContain("Go"); // "go-to-market" no es el lenguaje Go

    const { rows } = await pool.query(
      `SELECT title, company, tags, location, is_remote, job_type, salary_min, salary_max, salary_currency,
              url, posted_at, raw->>'thread_id' AS thread_id
         FROM jobs WHERE source = 'hn' AND external_id = '9100001'`,
    );
    expect(rows[0]).toMatchObject({
      title: "Senior TypeScript Engineer",
      company: "Acme Cloud",
      tags: ["hn:2026-11"],
      location: "Berlin, Germany",
      is_remote: false,
      job_type: "full_time",
      salary_min: 70000,
      salary_max: 90000,
      salary_currency: "EUR",
      url: "https://news.ycombinator.com/item?id=9100001",
      thread_id: "9000003",
    });
    expect(new Date(rows[0].posted_at).toISOString()).toBe("2026-11-02T16:10:00.000Z");

    // Segunda ejecución: mismas ofertas, ninguna duplicada.
    const again = await runSourceEtl(pool, config(), hnSource, enrichment);
    expect(again).toMatchObject({ status: "ok", inserted: 0, updated: 9 });
    expect((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE source = 'hn'")).rows[0].n).toBe(9);
  });

  it("informe por fuente: cuenta solo ofertas tecnológicas y expresa cada skill como % de su fuente", async () => {
    for (const src of [remotiveSource, arbeitnowSource, hnSource]) await runSourceEtl(pool, config(), src, enrichment);
    const data = await getSkillShares(pool);

    // Los totales por fuente coinciden con lo que hay en la tabla.
    for (const s of data.sources) {
      const { rows } = await pool.query("SELECT count(*)::int AS n, (count(*) FILTER (WHERE is_tech))::int AS t FROM jobs WHERE source = $1", [s.source]);
      expect(s).toEqual({ source: s.source, jobs: rows[0].n, techJobs: rows[0].t });
    }
    expect(data.sources.map((s) => s.source)).toEqual(["arbeitnow", "hn", "remotive"]);

    // Invariantes: ninguna skill supera el 100 % ni las ofertas tecnológicas de su fuente.
    const tech = new Map(data.sources.map((s) => [s.source, s.techJobs]));
    for (const sk of data.skills) {
      expect(sk.total).toBe(Object.values(sk.bySource).reduce((n, v) => n + v.count, 0));
      for (const [src, v] of Object.entries(sk.bySource)) {
        expect(v.count).toBeLessThanOrEqual(tech.get(src)!);
        expect(v.pct).toBeGreaterThan(0);
        expect(v.pct).toBeLessThanOrEqual(100);
      }
    }

    // En el hilo de HN solo una oferta menciona TypeScript, y es tecnológica.
    const ts = data.skills.find((s) => s.skill === "TypeScript")!;
    expect(ts.bySource.hn?.count).toBe(1);

    // La oferta de ventas de HN (is_tech = false) menciona SQL, pero NO debe contarse en el informe.
    const sqlHn = (
      await pool.query(
        `SELECT count(*)::int AS n FROM job_skills js JOIN jobs j ON j.id = js.job_id JOIN skills s ON s.id = js.skill_id
          WHERE j.source = 'hn' AND j.is_tech AND s.name = 'SQL'`,
      )
    ).rows[0].n;
    const sqlAll = (
      await pool.query(
        `SELECT count(*)::int AS n FROM job_skills js JOIN jobs j ON j.id = js.job_id JOIN skills s ON s.id = js.skill_id
          WHERE j.source = 'hn' AND s.name = 'SQL'`,
      )
    ).rows[0].n;
    expect(sqlAll).toBeGreaterThan(sqlHn); // hay una mención en una oferta no tecnológica...
    expect(data.skills.find((s) => s.skill === "SQL")?.bySource.hn?.count ?? 0).toBe(sqlHn); // ...y el informe la ignora
  });

  it("Arbeitnow: guarda etiquetas, distingue ofertas no técnicas y no confunde 'Go to market' con Go", async () => {
    const outcome = await runSourceEtl(pool, config(), arbeitnowSource, enrichment);
    expect(outcome).toEqual({ status: "ok", fetched: 4, inserted: 3, updated: 0, skipped: 1 });

    expect(await skillsOf("arbeitnow", "senior-backend-engineer-berlin-5001")).toEqual(
      expect.arrayContaining(["Go", "Kubernetes", "PostgreSQL", "Docker", "Terraform"]),
    );
    expect(await skillsOf("arbeitnow", "kundenberater-muenchen-5002")).toEqual([]);
    expect(await isTech("arbeitnow", "senior-backend-engineer-berlin-5001")).toBe(true);
    expect(await isTech("arbeitnow", "frontend-developer-remote-5003")).toBe(true);
    expect(await isTech("arbeitnow", "kundenberater-muenchen-5002")).toBe(false);

    const { rows } = await pool.query("SELECT tags, job_type, is_remote FROM jobs WHERE external_id = 'senior-backend-engineer-berlin-5001'");
    expect(rows[0]).toEqual({ tags: ["Software Development"], job_type: "full_time", is_remote: false });
  });

  it("es idempotente: correr dos veces no duplica y conserva first_seen_at", async () => {
    await runSourceEtl(pool, config(), remotiveSource, enrichment);
    const before = await pool.query("SELECT first_seen_at, last_seen_at FROM jobs WHERE external_id = '1001'");
    const skillLinksBefore = (await pool.query("SELECT count(*)::int AS n FROM job_skills")).rows[0].n;
    expect(skillLinksBefore).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 20));
    const second = await runSourceEtl(pool, config(), remotiveSource, enrichment);
    expect(second).toMatchObject({ status: "ok", inserted: 0, updated: 4 });

    expect((await pool.query("SELECT count(*)::int AS n FROM jobs")).rows[0].n).toBe(4);
    expect((await pool.query("SELECT count(*)::int AS n FROM job_skills")).rows[0].n).toBe(skillLinksBefore);

    const after = await pool.query("SELECT first_seen_at, last_seen_at FROM jobs WHERE external_id = '1001'");
    expect(after.rows[0].first_seen_at).toEqual(before.rows[0].first_seen_at);
    expect(after.rows[0].last_seen_at.getTime()).toBeGreaterThan(before.rows[0].last_seen_at.getTime());
  });

  it("al actualizar una oferta REEMPLAZA sus skills (no se acumulan las viejas)", async () => {
    await runSourceEtl(pool, config(), remotiveSource, enrichment);
    expect(await skillsOf("remotive", "1005")).toContain("Docker");

    const changed: Source = {
      name: "remotive",
      fetch: async () => {
        const base = await remotiveSource.fetch();
        return {
          invalid: base.invalid,
          jobs: base.jobs.map((j) => (j.externalId === "1005" ? { ...j, description: "Solo Python y Django." } : j)),
        };
      },
    };
    await runSourceEtl(pool, config(), changed, enrichment);
    expect(await skillsOf("remotive", "1005")).toEqual(["Django", "Python"]);
  });

  it("no cuenta una skill dos veces ni rompe la clave primaria de job_skills", async () => {
    const dup = enrichJob(
      { ...(await remotiveSource.fetch()).jobs[0]!, description: "Python python PYTHON" },
      enrichment.extract,
    );
    await upsertJobs(pool, [dup], enrichment.skillIds);
    // "Python" aparece 3 veces en la descripción y cuenta una sola; TypeScript viene del título.
    expect(await skillsOf("remotive", "1001")).toEqual(["Python", "TypeScript"]);
  });

  it("revierte todo si una oferta falla (transacción)", async () => {
    const jobs = (await remotiveSource.fetch()).jobs.map((j) => enrichJob(j, enrichment.extract));
    const bad = { ...jobs[1]!, job: { ...jobs[1]!.job, salaryMin: 200_000, salaryMax: 100_000 } }; // viola el CHECK de salario
    await expect(upsertJobs(pool, [jobs[0]!, bad], enrichment.skillIds)).rejects.toThrow();
    expect((await pool.query("SELECT count(*)::int AS n FROM jobs")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM job_skills")).rows[0].n).toBe(0);
  });

  it("la guarda de frecuencia es POR FUENTE e incluye ejecuciones fallidas", async () => {
    expect(await ranRecently(pool, "remotive", 6)).toBeNull();
    await pool.query("INSERT INTO etl_runs (source, status, finished_at) VALUES ('remotive', 'error', now())");
    expect(await ranRecently(pool, "remotive", 6)).toBeInstanceOf(Date);
    expect(await ranRecently(pool, "arbeitnow", 6)).toBeNull(); // otra fuente no se ve afectada
    await pool.query("UPDATE etl_runs SET started_at = now() - interval '7 hours'");
    expect(await ranRecently(pool, "remotive", 6)).toBeNull();
  });

  it("omite la ejecución de una fuente consultada hace poco (sin llamar a la fuente)", async () => {
    await pool.query("INSERT INTO etl_runs (source, status, finished_at) VALUES ('remotive', 'ok', now())");
    let called = false;
    const spy: Source = { name: "remotive", fetch: async () => ((called = true), { jobs: [], invalid: 0 }) };
    const outcome = await runSourceEtl(pool, config({ FORCE_RUN: false }), spy, enrichment);
    expect(outcome.status).toBe("skipped");
    expect(called).toBe(false);
  });

  it("una fuente que falla queda registrada y NO impide que corran las demás", async () => {
    const result = await runAllSources(pool, config(), enrichment, (name) =>
      name === "remotive" ? remotiveSource : failingSource,
    );

    expect(result.ok).toBe(false);
    expect(result.outcomes.remotive).toMatchObject({ status: "ok", inserted: 4 });
    expect(result.outcomes.arbeitnow).toEqual({ status: "error", error: "API caída" });

    const { rows } = await pool.query("SELECT source, status, error FROM etl_runs ORDER BY id");
    expect(rows).toEqual([
      { source: "remotive", status: "ok", error: null },
      { source: "arbeitnow", status: "error", error: "API caída" },
    ]);
    expect((await pool.query("SELECT count(*)::int AS n FROM jobs")).rows[0].n).toBe(4);
  });

  it("reprocess recalcula skills e is_tech desde el texto guardado, sin llamar a ninguna API", async () => {
    await runSourceEtl(pool, config(), remotiveSource, enrichment);
    await runSourceEtl(pool, config(), arbeitnowSource, enrichment);

    // Simulamos datos viejos/incorrectos (como los de antes del extractor)
    await pool.query("DELETE FROM job_skills");
    await pool.query("UPDATE jobs SET is_tech = false");

    const result = await reprocessJobs(pool, enrichment);
    expect(result.processed).toBe(7);
    expect(result.tech).toBe(6); // todas menos "Kundenberater"
    expect(await skillsOf("remotive", "1001")).toEqual(["Node.js", "PostgreSQL", "React", "Redis", "TypeScript"]);
    expect(await isTech("arbeitnow", "kundenberater-muenchen-5002")).toBe(false);
  });
});
