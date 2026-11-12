import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

type Handler = unknown | ((url: URL) => Response);

/** Simula la API: cada ruta devuelve JSON (200) o una Response propia. Una ruta no declarada hace fallar el test. */
function mockApi(routes: Record<string, Handler>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), "http://localhost");
      calls.push(url.pathname + url.search);
      const handler = routes[url.pathname];
      if (handler === undefined) throw new Error(`Ruta no simulada: ${url.pathname}`);
      if (typeof handler === "function") return (handler as (u: URL) => Response)(url);
      return new Response(JSON.stringify(handler), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

const overview = {
  totals: { jobs: 1100, techJobs: 1000, sources: 2, skillsInCatalog: 111 },
  sources: [
    { source: "arbeitnow", jobs: 900, techJobs: 880, latestPostedAt: null, newLast24h: 3 },
    { source: "hn", jobs: 200, techJobs: 120, latestPostedAt: null, newLast24h: 0 },
  ],
};
const health = {
  status: "ok",
  database: "up",
  etl: [{ source: "hn", status: "ok", startedAt: "2026-11-11T09:00:00Z", finishedAt: "2026-11-11T09:01:00Z", fetched: 1, inserted: 0, updated: 1, skipped: 0 }],
};
const base = { "/api/stats/overview": overview, "/api/health": health };

function renderApp(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Ranking", () => {
  it("muestra el titular generado por el dato y cada tecnología con su porcentaje", async () => {
    mockApi({
      ...base,
      "/api/skills/top": {
        totalJobs: 1000,
        skills: [
          { name: "Python", category: "language", jobs: 314, pct: 31.4 },
          { name: "AWS", category: "cloud", jobs: 228, pct: 22.8 },
        ],
      },
    });
    renderApp("/");

    expect(await screen.findByRole("heading", { level: 1, name: /Python aparece en 1 de cada 3/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /AWS: 22,8 % de las ofertas/ })).toBeInTheDocument();
    expect(screen.getByText("314 de 1000 ofertas")).toBeInTheDocument();
    // la cabecera común informa del estado de los datos
    expect(await screen.findByText(/1100 ofertas guardadas, 1000 de tecnología/)).toBeInTheDocument();
  });

  it("filtrar por fuente pide solo esa fuente a la API", async () => {
    const calls = mockApi({ ...base, "/api/skills/top": { totalJobs: 120, skills: [{ name: "React", category: "frontend", jobs: 38, pct: 31.4 }] } });
    renderApp("/");
    await screen.findByText("React");
    await userEvent.click(screen.getByRole("radio", { name: /Hacker News/ }));
    await vi.waitFor(() => expect(calls.some((c) => c.startsWith("/api/skills/top") && c.includes("source=hn"))).toBe(true));
  });

  it("si la API falla muestra el mensaje real, avisa con role=alert y permite reintentar", async () => {
    let ok = false;
    mockApi({
      ...base,
      "/api/skills/top": () =>
        ok
          ? new Response(JSON.stringify({ totalJobs: 10, skills: [{ name: "Go", category: "language", jobs: 5, pct: 50 }] }), { status: 200 })
          : new Response(JSON.stringify({ error: { code: "database_not_ready", message: "La base de datos todavía no está lista." } }), { status: 503 }),
    });
    renderApp("/");

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("La base de datos todavía no está lista.")).toBeInTheDocument();

    ok = true;
    await userEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Go")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sin ofertas explica qué hacer en vez de mostrar una tabla vacía", async () => {
    mockApi({ ...base, "/api/skills/top": { totalJobs: 0, skills: [] } });
    renderApp("/");
    expect(await screen.findByText("No hay tecnologías para este filtro")).toBeInTheDocument();
  });
});

describe("Ofertas", () => {
  const job = (over: Record<string, unknown>) => ({
    id: 1, source: "hn", title: "Dev", company: "Acme", location: null, isRemote: false, isTech: true, jobType: null,
    salaryMin: null, salaryMax: null, salaryCurrency: null, postedAt: "2026-11-05T10:00:00Z", url: "https://example.com/1", skills: ["React"], ...over,
  });
  const list = (data: unknown[]) => ({ attribution: "x", page: 1, pageSize: 20, total: data.length, totalPages: 1, data });

  it("cada título enlaza a la publicación original en pestaña nueva y sin filtrar el referrer", async () => {
    mockApi({ ...base, "/api/jobs": list([job({ title: "Senior React Dev" })]) });
    renderApp("/ofertas");
    const link = await screen.findByRole("link", { name: /Senior React Dev/ });
    expect(link).toHaveAttribute("href", "https://example.com/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("una URL peligrosa en los datos nunca llega a un enlace", async () => {
    mockApi({
      ...base,
      "/api/jobs": list([
        job({ id: 1, title: "Oferta con javascript", url: "javascript:alert(document.cookie)" }),
        job({ id: 2, title: "Oferta con data", url: "data:text/html,<script>alert(1)</script>" }),
        job({ id: 3, title: "Oferta normal", url: "https://example.com/3" }),
      ]),
    });
    renderApp("/ofertas");
    await screen.findByRole("link", { name: /Oferta normal/ });
    // las otras dos se muestran como texto, sin enlace
    expect(screen.getByText("Oferta con javascript")).toBeInTheDocument();
    expect(screen.getByText("Oferta con data")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Oferta con javascript/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Oferta con data/ })).not.toBeInTheDocument();
    for (const a of document.querySelectorAll("main a")) expect(a.getAttribute("href")).not.toMatch(/^(javascript|data):/i);
  });

  it("no repite 'Remoto' cuando la ubicación ya dice Remote", async () => {
    mockApi({ ...base, "/api/jobs": list([job({ isRemote: true, location: "Remote" })]) });
    renderApp("/ofertas");
    await screen.findByText("Acme");
    expect(screen.getByText("Remote")).toBeInTheDocument();
    expect(screen.queryByText("Remoto")).not.toBeInTheDocument();
  });

  it("buscar manda los filtros a la API (y el texto con caracteres raros va codificado)", async () => {
    const calls = mockApi({ ...base, "/api/jobs": list([job({})]) });
    renderApp("/ofertas");
    await screen.findByText("Acme");
    await userEvent.type(screen.getByRole("searchbox", { name: "Título o empresa" }), "c++ & co");
    await userEvent.type(screen.getByLabelText("Tecnologías separadas por comas"), "React, TypeScript");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await vi.waitFor(() => {
      const last = calls.filter((c) => c.startsWith("/api/jobs")).at(-1) ?? "";
      expect(last).toContain("q=c%2B%2B+%26+co");
      expect(last).toContain("skills=React%2CTypeScript");
    });
  });

  it("cambiar la fuente aplica el filtro aunque también se reinicie la página (varias escrituras a la URL en un evento)", async () => {
    const calls = mockApi({ ...base, "/api/jobs": list([job({})]) });
    renderApp("/ofertas?pagina=3&remoto=1");
    await screen.findByText("Acme");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Fuente" }), "hn");
    await vi.waitFor(() => {
      const last = calls.filter((c) => c.startsWith("/api/jobs")).at(-1) ?? "";
      expect(last).toContain("source=hn");
      expect(last).toContain("remote=true"); // lo que ya había se conserva
      expect(last).toContain("page=1"); // y la página vuelve a 1
    });
  });
});

describe("Fuentes", () => {
  it("avisa del margen de ruido y atenúa las diferencias que caben en él", async () => {
    mockApi({
      ...base,
      "/api/sources/compare": {
        a: { source: "hn", techJobs: 121 },
        b: { source: "arbeitnow", techJobs: 1008 },
        moreInA: [
          { name: "React", pctA: 31.4, pctB: 11.2, diff: 20.2, jobsA: 38, jobsB: 113 },
          { name: "Node.js", pctA: 6.6, pctB: 0, diff: 6.6, jobsA: 8, jobsB: 0 },
        ],
        moreInB: [{ name: "Agile", pctA: 0, pctB: 11.2, diff: -11.2, jobsA: 0, jobsB: 113 }],
        note: "",
      },
    });
    const { container } = renderApp("/fuentes");

    expect(await screen.findByText(/no se distingue del azar/)).toBeInTheDocument();
    expect(screen.getByText(/estilo del anuncio y no demanda/)).toBeInTheDocument();
    // solo Node.js (6,6 pp < ~9 pp) queda atenuado, y los lectores de pantalla lo oyen
    const dim = container.querySelectorAll("li.noise");
    expect(dim).toHaveLength(1);
    expect(dim[0]).toHaveTextContent("Node.js");
    expect(within(dim[0] as HTMLElement).getByText(/dentro del margen de ruido/)).toBeInTheDocument();
  });
});

describe("Mi match", () => {
  const job = (id: number, over: Record<string, unknown> = {}) => ({
    id, source: "hn", title: `Oferta ${id}`, company: "Acme", location: null, isRemote: false, isTech: true, jobType: null,
    salaryMin: null, salaryMax: null, salaryCurrency: null, postedAt: "2026-11-05T10:00:00Z", url: `https://example.com/${id}`,
    skills: ["PostgreSQL", "React", "TypeScript"], matched: ["React", "TypeScript"], missing: ["PostgreSQL"], coverage: 66.7, ...over,
  });
  const result = (over: Record<string, unknown> = {}) => ({
    attribution: "Datos de Remotive, Arbeitnow y Hacker News.",
    profile: { skills: ["React", "TypeScript"], unknown: [] },
    summary: { considered: 100, withAnyMatch: 40, atLeast50: 25, atLeast75: 10, full: 3 },
    learnNext: [{ name: "PostgreSQL", category: "database", unlocks: 7, closeJobs: 12 }],
    jobs: [job(1)],
    ...over,
  });
  const top = { totalJobs: 100, skills: [{ name: "Python", category: "language", jobs: 30, pct: 30 }, { name: "AWS", category: "cloud", jobs: 20, pct: 20 }] };

  it("sin tecnologías explica qué hacer y no consulta la API de match", async () => {
    const calls = mockApi({ ...base, "/api/skills/top": top });
    renderApp("/mi-match");
    expect(await screen.findByText("Añade las tecnologías que ya conoces")).toBeInTheDocument();
    expect(calls.some((c) => c.startsWith("/api/match"))).toBe(false);
    expect(await screen.findByRole("button", { name: "+ Python" })).toBeInTheDocument(); // atajos para empezar
  });

  it("muestra el titular, los tramos, lo que ya tienes y lo que falta en cada oferta", async () => {
    mockApi({ ...base, "/api/skills/top": top, "/api/match": result() });
    renderApp("/mi-match?t=React,TypeScript");

    expect(await screen.findByRole("heading", { level: 1, name: "Ya cubres todo lo que piden 3 ofertas" })).toBeInTheDocument();
    // los tres tramos: todo lo que piden (3), tres cuartas partes o más (10), la mitad o más (25)
    const funnel = screen.getByText("Todo lo que piden").closest("dl") as HTMLElement;
    expect(funnel.textContent).toMatch(/Todo lo que piden3.*Tres cuartas partes o más10.*La mitad o más25/);
    expect(screen.getByText("2 de 3")).toBeInTheDocument();
    // no depende solo del color: el texto para lectores de pantalla distingue lo que tienes de lo que falta
    expect(screen.getAllByText("Ya la tienes:", { exact: false })).toHaveLength(2); // React y TypeScript
    const lack = screen.getByText("PostgreSQL", { selector: ".tag.lack" });
    expect(lack).toHaveTextContent("Te falta: PostgreSQL");
    expect(screen.getByRole("link", { name: /Oferta 1/ })).toHaveAttribute("href", "https://example.com/1");
    expect(screen.getByText(/Es un cruce de listas, no una evaluación de ti/)).toBeInTheDocument();
  });

  it('"Probar con X" añade la tecnología al perfil y vuelve a consultar', async () => {
    const calls = mockApi({ ...base, "/api/skills/top": top, "/api/match": result() });
    renderApp("/mi-match?t=React,TypeScript");
    await userEvent.click(await screen.findByRole("button", { name: "Probar con PostgreSQL" }));
    await vi.waitFor(() => expect(calls.some((c) => c.startsWith("/api/match") && c.includes("skills=React%2CTypeScript%2CPostgreSQL"))).toBe(true));
    expect(screen.getByRole("button", { name: "Quitar PostgreSQL" })).toBeInTheDocument();
  });

  it("pegar varias tecnologías separadas por comas las añade todas, sin repetir", async () => {
    const calls = mockApi({ ...base, "/api/skills/top": top, "/api/match": result() });
    renderApp("/mi-match?t=React");
    await userEvent.type(await screen.findByLabelText(/Tecnologías que ya conoces/), "react, Go; node.js");
    await userEvent.click(screen.getByRole("button", { name: "Añadir" }));
    await vi.waitFor(() => expect(calls.some((c) => c.startsWith("/api/match") && c.includes("skills=React%2CGo%2Cnode.js"))).toBe(true));
  });

  it("avisa de los nombres que el catálogo no reconoce", async () => {
    mockApi({ ...base, "/api/skills/top": top, "/api/match": result({ profile: { skills: ["React"], unknown: ["cobol"] } }) });
    renderApp("/mi-match?t=React,cobol");
    expect(await screen.findByText(/No reconocemos: cobol/)).toBeInTheDocument();
  });

  it("si ninguna se reconoce, no enseña una lista vacía sin explicación", async () => {
    mockApi({ ...base, "/api/skills/top": top, "/api/match": result({ profile: { skills: [], unknown: ["cobol"] }, jobs: [], learnNext: [], summary: { considered: 0, withAnyMatch: 0, atLeast50: 0, atLeast75: 0, full: 0 } }) });
    renderApp("/mi-match?t=cobol");
    expect(await screen.findByText("Ninguna de esas tecnologías está en el catálogo")).toBeInTheDocument();
  });

  it("si la API falla, muestra el error con reintento", async () => {
    mockApi({ ...base, "/api/skills/top": top, "/api/match": () => new Response(JSON.stringify({ error: { code: "query_timeout", message: "La consulta tardó demasiado." } }), { status: 503 }) });
    renderApp("/mi-match?t=React");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("La consulta tardó demasiado.")).toBeInTheDocument();
  });

  it("la URL de una oferta peligrosa no se convierte en enlace", async () => {
    mockApi({ ...base, "/api/skills/top": top, "/api/match": result({ jobs: [job(9, { title: "Oferta rara", url: "javascript:alert(1)" })] }) });
    renderApp("/mi-match?t=React");
    await screen.findByText("Oferta rara");
    expect(screen.queryByRole("link", { name: /Oferta rara/ })).not.toBeInTheDocument();
  });
});

describe("Navegación", () => {
  it("una ruta que no existe ofrece volver al inicio", async () => {
    mockApi(base);
    renderApp("/no-existe");
    expect(await screen.findByText("Esta página no existe")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver al ranking/ })).toHaveAttribute("href", "/");
  });
});
