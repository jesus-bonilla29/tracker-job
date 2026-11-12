import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSkillExtractor, loadSkillDefinitions } from "../src/extract/skills.js";
import { enrichJob } from "../src/enrich.js";
import { looksLikeJobHeader, normalizeHnComment, parseHnHeader } from "../src/normalize/hn.js";
import {
  fetchHnComments,
  isHiringThreadTitle,
  parseSearchHits,
  parseThreadItem,
  type HnComment,
  type HnThread,
} from "../src/sources/hn.js";
import type { NormalizedJob } from "../src/types.js";

const load = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8"));
const searchPayload = load("hn-search.json");
const threadPayload = load("hn-thread.json");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noSleep = async () => undefined;

const thread: HnThread = {
  id: "9000003",
  title: "Ask HN: Who is hiring? (November 2026)",
  createdAt: new Date("2026-11-02T15:01:00Z"),
  month: "2026-11",
};

describe("isHiringThreadTitle", () => {
  it("acepta 'Who is hiring?' y rechaza los otros hilos de whoishiring", () => {
    expect(isHiringThreadTitle("Ask HN: Who is hiring? (November 2026)")).toBe(true);
    expect(isHiringThreadTitle("Ask HN: Who wants to be hired? (November 2026)")).toBe(false);
    expect(isHiringThreadTitle("Ask HN: Freelancer? Seeking freelancer? (November 2026)")).toBe(false);
    expect(isHiringThreadTitle(null)).toBe(false);
  });
});

describe("parseSearchHits", () => {
  it("devuelve solo los hilos 'Who is hiring?', del más reciente al más antiguo", () => {
    const threads = parseSearchHits(searchPayload);
    expect(threads.map((t) => t.id)).toEqual(["9000003", "9000001", "8999999"]);
    expect(threads[0]).toMatchObject({ month: "2026-11" });
  });

  it("lanza un error claro si falta 'hits'", () => {
    expect(() => parseSearchHits({ nope: true })).toThrow(/hits/);
  });
});

describe("parseThreadItem", () => {
  it("toma solo los comentarios de primer nivel y cuenta los eliminados", () => {
    const { comments, invalid } = parseThreadItem(threadPayload, thread);
    expect(comments).toHaveLength(10);
    expect(invalid).toBe(1); // el comentario eliminado (sin texto)
    expect(comments.map((c) => c.id)).not.toContain("9100099"); // la respuesta anidada se ignora
  });

  it("falla con un mensaje claro si el hilo no tiene el formato esperado", () => {
    expect(() => parseThreadItem("no es un objeto", thread)).toThrow(/formato/);
  });
});

describe("looksLikeJobHeader", () => {
  it("exige al menos 2 pipes", () => {
    expect(looksLikeJobHeader("Empresa | Rol | Lugar")).toBe(true);
    expect(looksLikeJobHeader("Empresa | Rol")).toBe(false);
    expect(looksLikeJobHeader("Solo un comentario cualquiera")).toBe(false);
  });
});

describe("parseHnHeader", () => {
  it("lee la convención clásica y no confunde el salario ni el tipo de contrato", () => {
    expect(parseHnHeader("Acme Cloud | Senior TypeScript Engineer | Berlin, Germany | Hybrid | Full-time | €70k-€90k")).toMatchObject({
      company: "Acme Cloud",
      role: "Senior TypeScript Engineer",
      location: "Berlin, Germany",
      jobType: "full_time",
      isRemote: false, // híbrido no es remoto
      salary: { min: 70_000, max: 90_000, currency: "EUR" },
    });
  });

  it("clasifica por contenido, no por posición (el orden varía entre ofertas)", () => {
    expect(parseHnHeader("Roof Insurance | ONSITE | San Francisco, CA")).toMatchObject({
      company: "Roof Insurance",
      role: null,
      location: "San Francisco, CA",
      isRemote: false,
    });
  });

  it("detecta remoto y conserva el detalle como ubicación", () => {
    expect(parseHnHeader("Pixel Labs | Frontend Developer | REMOTE (EU time zones) | Contract | $120k-150k")).toMatchObject({
      role: "Frontend Developer",
      location: "REMOTE (EU time zones)",
      jobType: "contract",
      isRemote: true,
      salary: { min: 120_000, max: 150_000, currency: "USD" },
    });
  });

  it("quita '(Series A)' del nombre de la empresa y entiende 'NYC - hybrid' como ubicación", () => {
    expect(parseHnHeader("WireCo (Series A) | Senior Software Engineer | NYC - hybrid | Full-time | $165k-$210k base + equity |")).toMatchObject({
      company: "WireCo",
      role: "Senior Software Engineer",
      location: "NYC - hybrid",
      isRemote: false,
      salary: { min: 165_000, max: 210_000, currency: "USD" },
    });
  });

  it("ignora URLs, abreviaturas de contrato (FT) y frases como 'US based, ...' pasan como ubicación", () => {
    expect(parseHnHeader("Electro | https://electro.example | Founders Associate | FT | US based, SF Bay Area preferred")).toMatchObject({
      company: "Electro",
      role: "Founders Associate",
      jobType: "full_time",
      location: "US based, SF Bay Area preferred",
    });
  });

  it("si el primer segmento es una URL, la empresa es el siguiente", () => {
    expect(parseHnHeader("https://acme.example | Acme | Backend Engineer | Remote").company).toBe("Acme");
  });

  it("no confunde 'Series B', '16M Funding' ni 'SaaS B2B' con una ubicación", () => {
    const h = parseHnHeader("Slidely | Full-Time | Remote in US & CAN | SaaS B2B Software | Series B | 16M Funding");
    expect(h.location).toBe("Remote in US & CAN");
    expect(h.isRemote).toBe(true);
    expect(h.salary.min).toBeNull();
  });

  it("entiende 'Multiple roles' y salario sin símbolo de moneda ('150-250k')", () => {
    const h = parseHnHeader("SmarterCo | 150-250k + equity + benefits | Remote (US only) | Multiple roles | ...");
    expect(h).toMatchObject({ multipleRoles: true, role: null, isRemote: true, salary: { min: 150_000, max: 250_000, currency: null } });
  });

  it("recorta la ubicación cuando la descripción se pegó al último segmento (falta un pipe)", () => {
    const h = parseHnHeader("Quantum Labs | Quantum Software Engineer | Full-time | Paris (HQ) or Remote (Europe) We are building a hub for quantum hackathons");
    expect(h.location).toBe("Paris (HQ) or Remote (Europe)");
    expect(h.isRemote).toBe(true);
  });

  it("reconoce roles no técnicos y no los toma por ubicación ('Account Executive')", () => {
    expect(parseHnHeader("GoToMarket Partners | Account Executive | Madrid | Onsite | Full-time")).toMatchObject({
      role: "Account Executive",
      location: "Madrid",
    });
  });

  it("quita prefijos como 'Roles:' del título (caso real)", () => {
    expect(parseHnHeader("Areo | Roles: Engineering Manager (Ruby on Rails) | Remote (EU) | Full-time").role).toBe(
      "Engineering Manager (Ruby on Rails)",
    );
  });

  it("'Dev Shop' o 'Agency' describen a la empresa, no son una ubicación (caso real)", () => {
    const h = parseHnHeader("Blackbird | Dev Shop | Contract | Remote");
    expect(h.location).toBe("Remote");
    expect(h.jobType).toBe("contract");
  });

  it("'SEEKING FREELANCER' es una etiqueta, no la empresa (caso real)", () => {
    expect(parseHnHeader("SEEKING FREELANCER | Devops Engineer | Remote - UK or EU")).toMatchObject({
      company: null,
      role: "Devops Engineer",
      location: "Remote - UK or EU",
      isRemote: true,
    });
  });

  it("sin rol reconocible, el segmento justo tras la empresa se toma como rol solo si hay otro candidato a lugar", () => {
    expect(parseHnHeader("Acme | Wizard of Light Bulbs | Springfield | Onsite")).toMatchObject({
      role: "Wizard of Light Bulbs",
      location: "Springfield",
    });
    // Con un único candidato es el lugar, no el rol.
    expect(parseHnHeader("Acme | Springfield | Onsite")).toMatchObject({ role: null, location: "Springfield" });
    // Si lo primero es un marcador, no se promueve nada a rol.
    expect(parseHnHeader("Acme | Remote | Berlin | Munich")).toMatchObject({ role: null, location: "Berlin" });
  });

  it("'no remote' / 'onsite only' NO cuentan como remoto", () => {
    expect(parseHnHeader("Acme | Engineer | Berlin | No remote").isRemote).toBe(false);
    expect(parseHnHeader("Acme | Engineer | Berlin | Onsite only, remote not possible").isRemote).toBe(false);
  });

  it("un código postal no se interpreta como salario", () => {
    expect(parseHnHeader("Acme | Engineer | Paris 75008 | Full-time").salary).toEqual({ min: null, max: null, currency: null });
  });
});

describe("normalizeHnComment", () => {
  const { comments } = parseThreadItem(threadPayload, thread);
  const byId = (id: string): HnComment => comments.find((c) => c.id === id)!;
  const normalize = (id: string): NormalizedJob | null => normalizeHnComment(byId(id));

  it("mapea los campos al formato común y enlaza al comentario original", () => {
    expect(normalize("9100001")).toMatchObject({
      source: "hn",
      externalId: "9100001",
      title: "Senior TypeScript Engineer",
      company: "Acme Cloud",
      tags: ["hn:2026-11"],
      jobType: "full_time",
      isRemote: false,
      salaryMin: 70_000,
      salaryMax: 90_000,
      salaryCurrency: "EUR",
      url: "https://news.ycombinator.com/item?id=9100001",
    });
    expect(normalize("9100001")!.postedAt?.toISOString()).toBe("2026-11-02T16:10:00.000Z");
  });

  it("convierte <p> sin cerrar en párrafos y decodifica entidades", () => {
    const description = normalize("9100001")!.description!;
    expect(description.split("\n")[0]).toBe("Acme Cloud | Senior TypeScript Engineer | Berlin, Germany | Hybrid | Full-time | €70k-€90k");
    expect(description).toContain("Node.js & TypeScript");
    expect(description).toContain("https://acme.example/jobs");
    expect(description).not.toMatch(/<[a-z]|&#x2F;|&amp;/i);
  });

  it("descarta comentarios que no son ofertas (meta, sin pipes)", () => {
    expect(normalize("9100004")).toBeNull();
  });

  it("toma el rol de las primeras líneas del cuerpo si la cabecera no lo trae", () => {
    expect(normalize("9100007")!.title).toBe("Senior Platform Engineer");
    expect(normalize("9100003")!.title).toBe("Senior Backend Engineer (Go, PostgreSQL, Kubernetes)");
  });

  it("una oferta sin empresa se guarda igualmente, con su rol como título", () => {
    const job = normalizeHnComment({ ...byId("9100003"), html: "SEEKING FREELANCER | Devops Engineer | Remote - UK or EU<p>Terraform and AWS." });
    expect(job).toMatchObject({ company: null, title: "Devops Engineer", isRemote: true });
  });

  it("una oferta de ventas conserva su rol y su ciudad", () => {
    expect(normalize("9100010")).toMatchObject({ title: "Account Executive", location: "Madrid", jobType: "full_time" });
  });

  it("usa 'Multiple roles' o un título de reserva cuando no hay rol", () => {
    expect(normalize("9100011")!.title).toBe("Multiple roles");
    expect(normalizeHnComment({ ...byId("9100003"), html: "Mystery Co | Remote | Worldwide<p>Come work with us." })!.title).toBe(
      "Mystery Co (Hacker News)",
    );
  });

  it("guarda el comentario original sin las respuestas, para poder reprocesarlo", () => {
    const raw = normalize("9100001")!.raw as Record<string, unknown>;
    expect(raw).toMatchObject({ id: "9100001", author: "acme_hr", thread_id: "9000003" });
    expect(raw).not.toHaveProperty("children");
  });
});

describe("integración con el extractor de skills y la relevancia", () => {
  it("las ofertas técnicas quedan como is_tech y la de ventas no", async () => {
    const extract = createSkillExtractor(await loadSkillDefinitions());
    const { comments } = parseThreadItem(threadPayload, thread);
    const enriched = comments.flatMap((c) => normalizeHnComment(c) ?? []).map((j) => enrichJob(j, extract));
    const get = (id: string) => enriched.find((e) => e.job.externalId === id)!;

    expect(get("9100001").skills).toEqual(expect.arrayContaining(["Node.js", "TypeScript", "React", "PostgreSQL", "AWS"]));
    expect(get("9100001").isTech).toBe(true);
    expect(get("9100003").skills).toEqual(expect.arrayContaining(["Go", "PostgreSQL", "Kubernetes"]));
    expect(get("9100009").skills).toEqual(expect.arrayContaining(["Python", "Django"]));
    expect(get("9100010").isTech).toBe(false); // "Account Executive", go-to-market, Excel y SQL: no es tecnología
    expect(get("9100010").skills).not.toContain("Go");
  });
});

describe("fetchHnComments", () => {
  const route = (opts: { failItemFor?: string } = {}) =>
    vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/search_by_date")) return json(searchPayload);
      const id = url.split("/items/")[1];
      if (id === opts.failItemFor) return new Response("boom", { status: 500 });
      return json({ ...(threadPayload as object), id: Number(id) });
    });

  it("busca el hilo más reciente y lo descarga con una sola petición adicional", async () => {
    const fetchImpl = route();
    const result = await fetchHnComments({ fetchImpl: fetchImpl as typeof fetch, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [searchUrl, itemUrl] = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(searchUrl).toContain("tags=story,author_whoishiring");
    expect(searchUrl).toContain("query=Ask%20HN%3A%20Who%20is%20hiring%3F");
    expect(itemUrl).toBe("https://hn.algolia.com/api/v1/items/9000003");
    expect(result.threads.map((t) => t.id)).toEqual(["9000003"]);
    expect(result.comments).toHaveLength(10);
  });

  it("con threads=2 recorre el hilo anterior (histórico) con una pausa entre hilos", async () => {
    const fetchImpl = route();
    const delays: number[] = [];
    const result = await fetchHnComments({
      threads: 2,
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async (ms) => void delays.push(ms),
      threadDelayMs: 1234,
    });
    expect(result.threads.map((t) => t.id)).toEqual(["9000003", "9000001"]);
    expect(delays).toEqual([1234]);
    expect(new Set(result.comments.map((c) => c.thread.month))).toEqual(new Set(["2026-11", "2026-10"]));
  });

  it("si falla un hilo anterior, conserva lo ya descargado en vez de fallar todo", async () => {
    const fetchImpl = route({ failItemFor: "9000001" });
    const result = await fetchHnComments({ threads: 2, fetchImpl: fetchImpl as typeof fetch, sleep: noSleep, retries: 0 });
    expect(result.threads.map((t) => t.id)).toEqual(["9000003"]);
    expect(result.comments).toHaveLength(10);
  });

  it("si falla el primer hilo, lanza el error (no hay nada que conservar)", async () => {
    const fetchImpl = route({ failItemFor: "9000003" });
    await expect(
      fetchHnComments({ fetchImpl: fetchImpl as typeof fetch, sleep: noSleep, retries: 0 }),
    ).rejects.toThrow(/500/);
  });

  it("falla con un mensaje claro si la búsqueda no encuentra ningún hilo", async () => {
    const fetchImpl = vi.fn(async () => json({ hits: [] }));
    await expect(fetchHnComments({ fetchImpl: fetchImpl as typeof fetch, sleep: noSleep })).rejects.toThrow(
      /Who is hiring/,
    );
  });
});
