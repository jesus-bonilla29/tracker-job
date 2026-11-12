import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

/**
 * Pruebas de integración contra PostgreSQL real, a través de HTTP (supertest).
 * Solo corren si defines TEST_DATABASE_URL. ¡Usa una base de datos de pruebas: BORRAN el esquema public!
 *
 * Los datos son pequeños y deterministas para poder calcular a mano cada resultado esperado.
 *
 *  id  fuente     tech remoto  publicada (UTC)        tecnologías                    notas
 *   1  hn         sí   sí      2026-09-15 10:00       TypeScript, React, PostgreSQL  salario 90k-120k USD
 *   2  hn         sí   no      2026-09-20 12:00       Python, PostgreSQL             título "Backend 100% Python", empresa "Beta_Co"
 *   3  hn         sí   sí      2026-10-01 00:00       TypeScript, React              justo en el límite de `from`
 *   4  arbeitnow  sí   no      2026-10-02 23:30       Python, Go                     salario 50k-60k EUR
 *   5  arbeitnow  sí   no      2026-10-20 09:00       TypeScript                     visto hace 30 días
 *   6  arbeitnow  NO   no      2026-10-21 09:00       —                              "Marketing Manager"
 *   7  remotive   sí   no      (sin fecha)            TypeScript
 */
const url = process.env.TEST_DATABASE_URL;

const MIGRATIONS = path.join(import.meta.dirname, "../../../db/migrations");

describe.skipIf(!url)("API (PostgreSQL real)", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;
  const get = (p: string) => request(app).get(p);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
      await pool.query(readFileSync(path.join(MIGRATIONS, f), "utf8"));
    }

    await pool.query(`INSERT INTO skills (id, name, category) VALUES
      (1,'TypeScript','language'),(2,'React','framework'),(3,'Python','language'),(4,'PostgreSQL','database'),(5,'Go','language')`);

    await pool.query(
      `INSERT INTO jobs (id, source, external_id, title, company, location, is_remote, is_tech, job_type, salary_min, salary_max, salary_currency, description, tags, url, posted_at, first_seen_at) VALUES
      (1,'hn','e1','Senior TypeScript Engineer','Acme','Berlin',true,true,'full_time',90000,120000,'USD','Descripción completa de Acme','{backend,remote}','https://example.test/1','2026-09-15T10:00:00Z', now()),
      (2,'hn','e2','Backend 100% Python','Beta_Co',NULL,false,true,NULL,NULL,NULL,NULL,'Texto','{}','https://example.test/2','2026-09-20T12:00:00Z', now()),
      (3,'hn','e3','Frontend Engineer','Gamma',NULL,true,true,NULL,NULL,NULL,NULL,NULL,'{}','https://example.test/3','2026-10-01T00:00:00Z', now()),
      (4,'arbeitnow','e4','Python Developer','Delta','Madrid',false,true,NULL,50000,60000,'EUR',NULL,'{}','https://example.test/4','2026-10-02T23:30:00Z', now()),
      (5,'arbeitnow','e5','TypeScript Developer','Epsilon',NULL,false,true,NULL,NULL,NULL,NULL,NULL,'{}','https://example.test/5','2026-10-20T09:00:00Z', now() - interval '30 days'),
      (6,'arbeitnow','e6','Marketing Manager','Zeta',NULL,false,false,NULL,NULL,NULL,NULL,NULL,'{}','https://example.test/6','2026-10-21T09:00:00Z', now()),
      (7,'remotive','e7','Full Stack Developer','Eta',NULL,false,true,NULL,NULL,NULL,NULL,NULL,'{}','https://example.test/7',NULL, now())`,
    );
    await pool.query(`INSERT INTO job_skills (job_id, skill_id) VALUES
      (1,1),(1,2),(1,4),(2,3),(2,4),(3,1),(3,2),(4,3),(4,5),(5,1),(7,1)`);

    await pool.query(`INSERT INTO etl_runs (source, started_at, finished_at, fetched, inserted, updated, skipped, status, error) VALUES
      ('hn', now() - interval '2 days', now() - interval '2 days', 0,0,0,0,'error','boom'),
      ('hn', now() - interval '1 hour', now() - interval '59 minutes', 193, 10, 183, 0, 'ok', NULL),
      ('arbeitnow', now() - interval '3 hours', now() - interval '2 hours', 100, 100, 0, 2, 'ok', NULL)`);

    app = createApp({ pool, corsOrigins: ["http://localhost:5173"], rateLimitPerMin: 0, cacheSeconds: 60, validateResponses: true });
  });

  afterAll(async () => {
    await pool?.end();
  });

  const jobsCount = async () => Number((await pool.query("SELECT count(*) FROM jobs")).rows[0].count);

  describe("GET /api/health", () => {
    it("devuelve la última ejecución de cada fuente y no se cachea", async () => {
      const res = await get("/api/health").expect(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body.status).toBe("ok");
      expect(res.body.database).toBe("up");
      const bySource = Object.fromEntries(res.body.etl.map((r: { source: string }) => [r.source, r]));
      expect(Object.keys(bySource).sort()).toEqual(["arbeitnow", "hn"]);
      expect(bySource.hn).toMatchObject({ status: "ok", fetched: 193, inserted: 10, updated: 183 }); // la de hace 1 h, no la de error
      expect(bySource.arbeitnow).toMatchObject({ skipped: 2 });
    });
  });

  describe("GET /api/stats/overview", () => {
    it("cuenta ofertas, ofertas tech, fuentes y catálogo", async () => {
      const res = await get("/api/stats/overview").expect(200);
      expect(res.body.totals).toEqual({ jobs: 7, techJobs: 6, sources: 3, skillsInCatalog: 5 });
      const by = Object.fromEntries(res.body.sources.map((s: { source: string }) => [s.source, s]));
      expect(by.hn).toMatchObject({ jobs: 3, techJobs: 3, newLast24h: 3 });
      expect(by.arbeitnow).toMatchObject({ jobs: 3, techJobs: 2, newLast24h: 2 }); // la oferta 5 se vio hace 30 días
      expect(by.remotive).toMatchObject({ jobs: 1, techJobs: 1, latestPostedAt: null });
      expect(by.hn.latestPostedAt).toBe("2026-10-01T00:00:00.000Z");
    });
  });

  describe("GET /api/skills/top", () => {
    it("ordena por menciones y calcula % sobre ofertas tech", async () => {
      const res = await get("/api/skills/top").expect(200);
      expect(res.body.totalJobs).toBe(6);
      expect(res.body.skills.map((s: { name: string; jobs: number; pct: number }) => [s.name, s.jobs, s.pct])).toEqual([
        ["TypeScript", 4, 66.7],
        ["PostgreSQL", 2, 33.3], // empate: desempata por nombre
        ["Python", 2, 33.3],
        ["React", 2, 33.3],
        ["Go", 1, 16.7],
      ]);
    });

    it("filtra por fuente y el % es sobre las ofertas de esa fuente", async () => {
      const res = await get("/api/skills/top?source=hn").expect(200);
      expect(res.body.totalJobs).toBe(3);
      expect(res.body.skills[0]).toMatchObject({ name: "PostgreSQL", jobs: 2, pct: 66.7 });
      expect(res.body.skills.find((s: { name: string }) => s.name === "Python")).toMatchObject({ jobs: 1, pct: 33.3 });
    });

    it("la categoría limita qué se lista pero no el denominador", async () => {
      const res = await get("/api/skills/top?category=language").expect(200);
      expect(res.body.totalJobs).toBe(6);
      expect(res.body.skills.map((s: { name: string }) => s.name)).toEqual(["TypeScript", "Python", "Go"]);
    });

    it("el rango de fechas incluye los extremos completos (UTC) y excluye ofertas sin fecha", async () => {
      const res = await get("/api/skills/top?from=2026-10-01&to=2026-10-02").expect(200);
      expect(res.body.totalJobs).toBe(2); // la 3 (00:00 del 1) y la 4 (23:30 del 2); no la 7 (sin fecha)
    });

    it("respeta limit", async () => {
      const res = await get("/api/skills/top?limit=2").expect(200);
      expect(res.body.skills).toHaveLength(2);
    });
  });

  describe("GET /api/skills/:name/trend", () => {
    it("agrupa por mes (UTC) y no distingue mayúsculas", async () => {
      const res = await get("/api/skills/typescript/trend").expect(200);
      expect(res.body.skill).toEqual({ name: "TypeScript", category: "language" });
      expect(res.body.series).toEqual([
        { period: "2026-09-01", jobs: 2, mentions: 1, pct: 50 },
        { period: "2026-10-01", jobs: 3, mentions: 2, pct: 66.7 },
      ]);
    });

    it("agrupa por semana empezando en lunes", async () => {
      const res = await get("/api/skills/TypeScript/trend?interval=week").expect(200);
      expect(res.body.series).toEqual([
        { period: "2026-09-14", jobs: 2, mentions: 1, pct: 50 },
        { period: "2026-09-28", jobs: 2, mentions: 1, pct: 50 }, // 1 oct y 2 oct 23:30 UTC siguen en la misma semana
        { period: "2026-10-19", jobs: 1, mentions: 1, pct: 100 },
      ]);
    });

    it("filtra por fuente", async () => {
      const res = await get("/api/skills/TypeScript/trend?source=arbeitnow").expect(200);
      expect(res.body.series).toEqual([{ period: "2026-10-01", jobs: 2, mentions: 1, pct: 50 }]);
    });

    it("404 si la tecnología no existe", async () => {
      const res = await get("/api/skills/Cobol/trend").expect(404);
      expect(res.body.error.code).toBe("not_found");
    });
  });

  describe("GET /api/skills/:name/cooccurrence", () => {
    it("lista qué se pide junto a la tecnología", async () => {
      const res = await get("/api/skills/TypeScript/cooccurrence").expect(200);
      expect(res.body.jobsWithSkill).toBe(4);
      expect(res.body.related.map((r: { name: string; jobs: number; pct: number }) => [r.name, r.jobs, r.pct])).toEqual([
        ["React", 2, 50],
        ["PostgreSQL", 1, 25],
      ]);
    });

    it("404 si no existe", async () => {
      await get("/api/skills/Cobol/cooccurrence").expect(404);
    });
  });

  describe("GET /api/jobs", () => {
    const ids = (res: request.Response) => res.body.data.map((j: { id: number }) => j.id);

    it("por defecto solo ofertas tech, de más reciente a más antigua y sin fecha al final", async () => {
      const res = await get("/api/jobs").expect(200);
      expect(res.body.total).toBe(6);
      expect(ids(res)).toEqual([5, 4, 3, 2, 1, 7]);
      expect(res.body.attribution).toMatch(/Remotive/);
      expect(res.body.data.find((j: { id: number }) => j.id === 1)).toMatchObject({
        source: "hn",
        company: "Acme",
        isRemote: true,
        salaryMin: 90000,
        salaryMax: 120000,
        salaryCurrency: "USD",
        skills: ["PostgreSQL", "React", "TypeScript"],
        url: "https://example.test/1",
      });
      // El resumen no incluye la descripción completa.
      expect(res.body.data[0]).not.toHaveProperty("description");
    });

    it("includeNonTech=true incluye las demás", async () => {
      const res = await get("/api/jobs?includeNonTech=true").expect(200);
      expect(res.body.total).toBe(7);
      expect(ids(res)[0]).toBe(6);
    });

    it("filtra por remoto, fuente y salario", async () => {
      expect(ids(await get("/api/jobs?remote=true").expect(200))).toEqual([3, 1]);
      expect(ids(await get("/api/jobs?source=arbeitnow").expect(200))).toEqual([5, 4]);
      expect(ids(await get("/api/jobs?hasSalary=true").expect(200))).toEqual([4, 1]);
      expect(ids(await get("/api/jobs?hasSalary=true&sort=salary").expect(200))).toEqual([1, 4]);
    });

    it("skills exige TODAS las tecnologías (sin distinguir mayúsculas)", async () => {
      expect(ids(await get("/api/jobs?skills=React,TypeScript").expect(200))).toEqual([3, 1]);
      expect(ids(await get("/api/jobs?skills=typescript,go").expect(200))).toEqual([]);
      expect(ids(await get("/api/jobs?skills=python,go").expect(200))).toEqual([4]);
      expect(ids(await get("/api/jobs?skills=Cobol").expect(200))).toEqual([]);
    });

    it("busca por título o empresa", async () => {
      expect(ids(await get("/api/jobs?q=acme").expect(200))).toEqual([1]);
      expect(ids(await get("/api/jobs?q=typescript").expect(200))).toEqual([5, 1]);
    });

    it("los comodines de LIKE se buscan literalmente", async () => {
      expect(ids(await get("/api/jobs?q=%25").expect(200))).toEqual([2]); // "%": solo el título con "100%"
      expect(ids(await get("/api/jobs?q=_").expect(200))).toEqual([2]); // "_": solo la empresa "Beta_Co"
    });

    it("pagina y calcula totalPages", async () => {
      const p1 = await get("/api/jobs?pageSize=4&page=1").expect(200);
      const p2 = await get("/api/jobs?pageSize=4&page=2").expect(200);
      expect(p1.body).toMatchObject({ total: 6, totalPages: 2, page: 1, pageSize: 4 });
      expect(ids(p1)).toEqual([5, 4, 3, 2]);
      expect(ids(p2)).toEqual([1, 7]);
      expect(ids(await get("/api/jobs?pageSize=4&page=3").expect(200))).toEqual([]);
    });

    it("rango de fechas", async () => {
      expect(ids(await get("/api/jobs?from=2026-10-01&to=2026-10-02").expect(200))).toEqual([4, 3]);
    });
  });

  describe("GET /api/jobs/:id", () => {
    it("devuelve el detalle con descripción, etiquetas y fechas", async () => {
      const res = await get("/api/jobs/1").expect(200);
      expect(res.body).toMatchObject({
        id: 1,
        description: "Descripción completa de Acme",
        tags: ["backend", "remote"],
        skills: ["PostgreSQL", "React", "TypeScript"],
      });
      expect(typeof res.body.firstSeenAt).toBe("string");
    });

    it("404 si no existe, 400 si el id no es válido", async () => {
      expect((await get("/api/jobs/999").expect(404)).body.error.code).toBe("not_found");
      await get("/api/jobs/abc").expect(400);
      await get("/api/jobs/0").expect(400);
      await get("/api/jobs/99999999999").expect(400);
    });
  });

  describe("GET /api/sources/compare", () => {
    it("compara en puntos porcentuales", async () => {
      const res = await get("/api/sources/compare?a=hn&b=arbeitnow&minMentions=1").expect(200);
      expect(res.body.a).toEqual({ source: "hn", techJobs: 3 });
      expect(res.body.b).toEqual({ source: "arbeitnow", techJobs: 2 });
      expect(res.body.moreInA.map((d: { name: string; diff: number }) => [d.name, d.diff])).toEqual([
        ["PostgreSQL", 66.7],
        ["React", 66.7],
        ["TypeScript", 16.7],
      ]);
      expect(res.body.moreInB.map((d: { name: string; diff: number }) => [d.name, d.diff])).toEqual([
        ["Go", -50],
        ["Python", -16.7],
      ]);
    });

    it("minMentions (3 por defecto) descarta tecnologías con pocas menciones", async () => {
      const res = await get("/api/sources/compare?a=hn&b=arbeitnow").expect(200);
      expect(res.body.moreInA.map((d: { name: string }) => d.name)).toEqual(["TypeScript"]);
      expect(res.body.moreInB).toEqual([]);
    });

    it("400 con la misma fuente en a y b; 404 con una fuente sin datos", async () => {
      await get("/api/sources/compare?a=hn&b=hn").expect(400);
      const res = await get("/api/sources/compare?a=hn&b=zzz").expect(404);
      expect(res.body.error.message).toMatch(/arbeitnow, hn, remotive/);
      await get("/api/sources/compare?a=hn").expect(400); // falta b
    });
  });

  describe("GET /api/match", () => {
    const names = (res: request.Response) => res.body.jobs.map((j: { id: number }) => j.id);

    it("ordena por % de encaje, luego por tecnologías en común y luego por fecha (sin fecha, al final)", async () => {
      const res = await get("/api/match?skills=TypeScript,React&minSkills=1").expect(200);
      expect(res.body.profile).toEqual({ skills: ["React", "TypeScript"], unknown: [] });
      // 3 (100 %, 2 en común) > 5 (100 %, 1, publicada el 20 oct) > 7 (100 %, 1, sin fecha) > 1 (66,7 %)
      expect(names(res)).toEqual([3, 5, 7, 1]);
      expect(res.body.jobs.map((j: { coverage: number }) => j.coverage)).toEqual([100, 100, 100, 66.7]);
    });

    it("separa lo que ya tienes de lo que te falta", async () => {
      const res = await get("/api/match?skills=TypeScript,React&minSkills=1").expect(200);
      const j1 = res.body.jobs.find((j: { id: number }) => j.id === 1);
      expect(j1).toMatchObject({ matched: ["React", "TypeScript"], missing: ["PostgreSQL"], coverage: 66.7, title: "Senior TypeScript Engineer" });
      expect(j1.url).toBe("https://example.test/1");
      expect(res.body.attribution).toMatch(/Remotive/);
    });

    it("resume cuántas ofertas caen en cada tramo", async () => {
      const res = await get("/api/match?skills=TypeScript,React&minSkills=1").expect(200);
      // ofertas tech con >=1 tecnología: 1,2,3,4,5,7. Con algún acierto: 1,3,5,7.
      expect(res.body.summary).toEqual({ considered: 6, withAnyMatch: 4, atLeast50: 4, atLeast75: 3, full: 3 });
    });

    it("minSkills (3 por defecto) descarta ofertas con pocas tecnologías detectadas", async () => {
      const res = await get("/api/match?skills=TypeScript,React").expect(200);
      expect(res.body.summary.considered).toBe(1); // solo la oferta 1 tiene 3 tecnologías
      expect(names(res)).toEqual([1]);
    });

    it("sugiere qué aprender: la tecnología que falta sola en más ofertas", async () => {
      const a = await get("/api/match?skills=TypeScript,React&minSkills=1").expect(200);
      expect(a.body.learnNext).toEqual([{ name: "PostgreSQL", category: "database", unlocks: 1, closeJobs: 1 }]);

      // Con TypeScript + PostgreSQL: a la 1 y a la 3 les falta solo React; a la 2 solo Python.
      const b = await get("/api/match?skills=TypeScript,PostgreSQL&minSkills=1").expect(200);
      expect(b.body.learnNext).toEqual([
        { name: "React", category: "framework", unlocks: 2, closeJobs: 2 },
        { name: "Python", category: "language", unlocks: 1, closeJobs: 1 },
      ]);
      // empate al 50 % entre la 2 y la 3: gana la más reciente (la 3)
      expect(names(b)).toEqual([5, 7, 1, 3, 2]);
    });

    it("no distingue mayúsculas, ignora repetidos y avisa de lo que no reconoce", async () => {
      const res = await get("/api/match?skills=typescript,TYPESCRIPT,Cobol,%20react%20&minSkills=1").expect(200);
      expect(res.body.profile).toEqual({ skills: ["React", "TypeScript"], unknown: ["cobol"] });
    });

    it("si no reconoce ninguna, responde vacío (no es un error)", async () => {
      const res = await get("/api/match?skills=Cobol,Fortran").expect(200);
      expect(res.body.profile).toEqual({ skills: [], unknown: ["cobol", "fortran"] });
      expect(res.body.jobs).toEqual([]);
      expect(res.body.summary.considered).toBe(0);
    });

    it("filtra por fuente", async () => {
      const res = await get("/api/match?skills=TypeScript&minSkills=1&source=hn").expect(200);
      expect(res.body.summary.considered).toBe(3); // hn tiene 3 ofertas tech
      expect(names(res)).toEqual([3, 1]);
    });

    it("limit recorta la lista pero no el resumen", async () => {
      const res = await get("/api/match?skills=TypeScript,React&minSkills=1&limit=2").expect(200);
      expect(names(res)).toEqual([3, 5]);
      expect(res.body.summary.withAnyMatch).toBe(4);
    });

    it.each([
      ["sin skills", "/api/match"],
      ["skills vacío", "/api/match?skills="],
      ["solo comas", "/api/match?skills=,,,"],
      ["más de 30 tecnologías", "/api/match?skills=" + Array.from({ length: 31 }, (_, i) => `t${i}`).join(",")],
      ["tecnología demasiado larga", "/api/match?skills=" + "x".repeat(61)],
      ["minSkills 0", "/api/match?skills=React&minSkills=0"],
      ["minSkills 11", "/api/match?skills=React&minSkills=11"],
      ["limit 51", "/api/match?skills=React&limit=51"],
      ["parámetro desconocido", "/api/match?skills=React&foo=1"],
    ])("400: %s", async (_name, p) => {
      const res = await get(p).expect(400);
      expect(res.body.error.code).toBe("validation_error");
    });

    it("la inyección SQL en skills no hace nada", async () => {
      const before = await jobsCount();
      const res = await get("/api/match?skills=" + encodeURIComponent("x'); DROP TABLE jobs; --")).expect(200);
      expect(res.body.profile.skills).toEqual([]);
      expect(await jobsCount()).toBe(before);
    });
  });

  describe("validación (400)", () => {
    const cases: Array<[string, string]> = [
      ["fecha inexistente", "/api/skills/top?from=2026-02-31"],
      ["formato de fecha", "/api/skills/top?from=31-12-2026"],
      ["from posterior a to", "/api/skills/top?from=2026-11-01&to=2026-10-01"],
      ["interval inválido", "/api/skills/TypeScript/trend?interval=day"],
      ["limit 0", "/api/skills/top?limit=0"],
      ["limit demasiado alto", "/api/skills/top?limit=101"],
      ["limit no numérico", "/api/skills/top?limit=abc"],
      ["pageSize demasiado alto", "/api/jobs?pageSize=101"],
      ["page 0", "/api/jobs?page=0"],
      ["booleano inválido", "/api/jobs?remote=yes"],
      ["parámetro desconocido", "/api/jobs?foo=1"],
      ["fuente con caracteres raros", "/api/jobs?source=" + encodeURIComponent("hn';DROP TABLE jobs;--")],
      ["más de 10 tecnologías", "/api/jobs?skills=a,b,c,d,e,f,g,h,i,j,k"],
      ["tecnología demasiado larga", "/api/jobs?skills=" + "x".repeat(61)],
      ["nombre de tecnología demasiado largo", "/api/skills/" + "x".repeat(61) + "/trend"],
      ["q demasiado larga", "/api/jobs?q=" + "x".repeat(101)],
    ];

    it.each(cases)("%s", async (_name, p) => {
      const res = await get(p).expect(400);
      expect(res.body.error.code).toBe("validation_error");
      expect(res.headers["cache-control"]).toBe("no-store"); // un error nunca se cachea
    });

    it("explica qué parámetro falló", async () => {
      const res = await get("/api/skills/top?from=2026-02-31&limit=0").expect(400);
      const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
      expect(paths).toEqual(["from", "limit"]);
    });
  });

  describe("seguridad", () => {
    it("la inyección SQL en q, skills y :name no hace nada", async () => {
      const before = await jobsCount();
      const evil = "'; DROP TABLE jobs; --";
      const q = await get("/api/jobs?q=" + encodeURIComponent(evil)).expect(200);
      expect(q.body.total).toBe(0);
      const s = await get("/api/jobs?skills=" + encodeURIComponent(evil)).expect(200);
      expect(s.body.total).toBe(0);
      await get("/api/skills/" + encodeURIComponent(evil) + "/trend").expect(404);
      await get("/api/skills/" + encodeURIComponent("x' OR '1'='1") + "/cooccurrence").expect(404);
      expect(await jobsCount()).toBe(before);
    });

    it("una ruta inexistente devuelve JSON 404", async () => {
      const res = await get("/api/nada").expect(404);
      expect(res.body.error.code).toBe("not_found");
      expect(res.headers["content-type"]).toMatch(/json/);
    });

    it("solo permite GET", async () => {
      await request(app).post("/api/jobs").expect(404);
      await request(app).delete("/api/jobs/1").expect(404);
    });

    it("una URL con codificación rota da 400, no 500", async () => {
      await get("/api/skills/%E0%A4%A/trend").expect(400);
    });

    it("cabeceras de seguridad y caché", async () => {
      const res = await get("/api/skills/top").expect(200);
      expect(res.headers["x-powered-by"]).toBeUndefined();
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["cache-control"]).toBe("public, max-age=60");
    });

    it("CORS: solo orígenes permitidos", async () => {
      const ok = await get("/api/health").set("Origin", "http://localhost:5173").expect(200);
      expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
      const bad = await get("/api/health").set("Origin", "http://evil.example").expect(200);
      expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("límite de peticiones: devuelve 429 al excederlo", async () => {
      const limited = createApp({ pool, corsOrigins: "*", rateLimitPerMin: 2, cacheSeconds: 0 });
      await request(limited).get("/api/health").expect(200);
      await request(limited).get("/api/health").expect(200);
      const res = await request(limited).get("/api/health").expect(429);
      expect(res.body.error.code).toBe("rate_limited");
    });
  });

  describe("detrás de un proxy (TRUST_PROXY)", () => {
    it("con trustProxy=1 el límite se aplica por IP real (X-Forwarded-For), no por la del proxy", async () => {
      const behind = createApp({ pool, corsOrigins: "*", rateLimitPerMin: 1, cacheSeconds: 0, trustProxy: 1 });
      await request(behind).get("/api/health").set("X-Forwarded-For", "203.0.113.10").expect(200);
      await request(behind).get("/api/health").set("X-Forwarded-For", "203.0.113.10").expect(429); // misma IP: bloqueada
      await request(behind).get("/api/health").set("X-Forwarded-For", "203.0.113.11").expect(200); // otra IP: tiene su cupo
    });

    it("sin trustProxy se ignora X-Forwarded-For: no se puede esquivar el límite falseando la cabecera", async () => {
      const direct = createApp({ pool, corsOrigins: "*", rateLimitPerMin: 1, cacheSeconds: 0 });
      await request(direct).get("/api/health").set("X-Forwarded-For", "203.0.113.20").expect(200);
      await request(direct).get("/api/health").set("X-Forwarded-For", "203.0.113.21").expect(429);
    });
  });

  describe("documentación", () => {
    it("/api/openapi.json describe todos los endpoints", async () => {
      const res = await get("/api/openapi.json").expect(200);
      expect(res.body.openapi).toMatch(/^3\./);
      expect(Object.keys(res.body.paths).sort()).toEqual(
        [
          "/api/health",
          "/api/jobs",
          "/api/jobs/{id}",
          "/api/match",
          "/api/skills/top",
          "/api/skills/{name}/cooccurrence",
          "/api/skills/{name}/trend",
          "/api/sources/compare",
          "/api/stats/overview",
        ].sort(),
      );
    });

    it("/api/docs sirve Swagger UI", async () => {
      const res = await get("/api/docs/").expect(200);
      expect(res.headers["content-type"]).toMatch(/html/);
    });
  });

  describe("fallos de la base de datos", () => {
    const brokenApp = (err: unknown) =>
      createApp({ pool: { query: async () => { throw err; } } as unknown as pg.Pool, corsOrigins: "*", rateLimitPerMin: 0, cacheSeconds: 0 });

    it("tablas sin crear (42P01) → 503 database_not_ready", async () => {
      const res = await request(brokenApp(Object.assign(new Error("relation jobs does not exist"), { code: "42P01" })))
        .get("/api/stats/overview")
        .expect(503);
      expect(res.body.error.code).toBe("database_not_ready");
    });

    it("statement_timeout (57014) → 503 query_timeout", async () => {
      const res = await request(brokenApp(Object.assign(new Error("canceling statement"), { code: "57014" })))
        .get("/api/jobs")
        .expect(503);
      expect(res.body.error.code).toBe("query_timeout");
    });

    it("un error inesperado → 500 genérico que no filtra detalles internos", async () => {
      const res = await request(brokenApp(new Error("password=hunter2 host=10.0.0.5"))).get("/api/jobs").expect(500);
      expect(res.body.error.code).toBe("internal_error");
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|10\.0\.0\.5/);
    });

    it("health sin conexión → 503 database_unavailable", async () => {
      const res = await request(brokenApp(new Error("ECONNREFUSED"))).get("/api/health").expect(503);
      expect(res.body.error.code).toBe("database_unavailable");
    });
  });
});
