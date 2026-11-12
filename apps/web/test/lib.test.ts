import { describe, expect, it } from "vitest";
import type { SkillShare, SkillTrend, SourceComparison } from "../src/api/types";
import {
  fmtInt,
  fmtPct,
  fmtPeriod,
  fmtPp,
  fmtSalary,
  relativeTime,
  safeHref,
  showRemoteBadge,
  sourceColor,
  sourceLabel,
} from "../src/lib/format";
import { buildCompareRows, categoriesOf, headline, noiseMarginPp } from "../src/lib/insights";
import { LOW_SAMPLE, addSelected, lastIndexWithValue, mergeTrends, removeSelected, yAxisScale } from "../src/lib/trend";

describe("formato", () => {
  it("porcentajes y enteros con convención española", () => {
    expect(fmtPct(31.4)).toBe("31,4 %");
    expect(fmtPct(0)).toBe("0,0 %");
    expect(fmtInt(1137)).toBe("1137");
    expect(fmtInt(12345)).toBe("12.345");
  });

  it("la diferencia en pp lleva signo explícito (menos tipográfico)", () => {
    expect(fmtPp(9.2)).toBe("+9,2 pp");
    expect(fmtPp(-9.2)).toBe("−9,2 pp");
    expect(fmtPp(0)).toBe("0,0 pp");
  });

  it("salarios", () => {
    expect(fmtSalary(64000, 103000, "EUR")).toBe("64k–103k EUR");
    expect(fmtSalary(50000, 50000, null)).toBe("50k");
    expect(fmtSalary(null, 90000, "USD")).toBe("90k USD");
    expect(fmtSalary(null, null, "USD")).toBeNull();
  });

  it("periodos en UTC, igual que la API (sin desfase por zona horaria)", () => {
    expect(fmtPeriod("2026-10-01", "month")).toBe("oct 2026");
    expect(fmtPeriod("2026-10-01", "week")).toBe("1 oct");
  });

  it("tiempo relativo con reloj inyectado", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(relativeTime("2026-11-11T09:00:00Z", now)).toBe("hace 3 horas");
    expect(relativeTime("2026-11-11T11:59:40Z", now)).toBe("ahora");
    expect(relativeTime("2026-11-06T12:00:00Z", now)).toBe("hace 5 días");
  });

  it("cada fuente conserva su etiqueta y su color; una desconocida no rompe", () => {
    expect(sourceLabel("hn")).toBe("Hacker News");
    expect(sourceLabel("otra")).toBe("otra");
    expect(sourceColor("hn")).toBe("var(--series-1)");
    expect(sourceColor("arbeitnow")).toBe("var(--series-2)");
    expect(sourceColor("otra")).toBe("var(--muted)");
  });
});

describe("safeHref: la URL de una oferta viene de fuera", () => {
  it("acepta http y https", () => {
    expect(safeHref("https://example.com/job/1")).toBe("https://example.com/job/1");
    expect(safeHref("http://example.com/")).toBe("http://example.com/");
  });

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "ftp://example.com", "file:///etc/passwd", "//evil.example", "no es una url", ""])(
    "rechaza %j",
    (url) => {
      expect(safeHref(url)).toBeUndefined();
    },
  );
});

describe("showRemoteBadge", () => {
  it("no repite 'Remoto' si la ubicación ya lo dice", () => {
    expect(showRemoteBadge(true, "Remote")).toBe(false);
    expect(showRemoteBadge(true, "Remoto (España)")).toBe(false);
    expect(showRemoteBadge(true, "Berlin")).toBe(true);
    expect(showRemoteBadge(true, null)).toBe(true);
    expect(showRemoteBadge(false, "Berlin")).toBe(false);
  });
});

const skill = (name: string, pct: number, category: string | null = "language"): SkillShare => ({ name, pct, jobs: Math.round(pct), category });

describe("insights", () => {
  it("el titular lo escribe el dato", () => {
    expect(headline([skill("Python", 31.4)], 1137)).toBe("Python aparece en 1 de cada 3 ofertas tecnológicas");
    expect(headline([skill("Python", 62)], 100)).toBe("Python aparece en más de la mitad de las ofertas tecnológicas");
    expect(headline([skill("Python", 45)], 100, "hn")).toBe("Python aparece en 1 de cada 2 ofertas tecnológicas de Hacker News");
    expect(headline([], 0)).toBe("Todavía no hay ofertas para mostrar");
  });

  it("margen de ruido: con 121 frente a 1008 ofertas, unos 9 pp", () => {
    expect(noiseMarginPp(121, 1008)).toBeCloseTo(9.4, 1);
    expect(noiseMarginPp(1000, 1000)).toBeLessThan(noiseMarginPp(100, 100)); // más ofertas, menos ruido
    expect(noiseMarginPp(0, 1000)).toBe(Infinity);
  });

  it("marca como ruido lo que cae dentro del margen", () => {
    const cmp: SourceComparison = {
      a: { source: "hn", techJobs: 121 },
      b: { source: "arbeitnow", techJobs: 1008 },
      moreInA: [
        { name: "React", pctA: 31.4, pctB: 11.2, diff: 20.2, jobsA: 38, jobsB: 113 },
        { name: "Node.js", pctA: 6.6, pctB: 0, diff: 6.6, jobsA: 8, jobsB: 0 },
      ],
      moreInB: [{ name: "Agile", pctA: 0, pctB: 11.2, diff: -11.2, jobsA: 0, jobsB: 113 }],
      note: "",
    };
    const { left, right, margin } = buildCompareRows(cmp);
    expect(margin).toBeGreaterThan(9);
    expect(left.map((r) => [r.name, r.size, r.noise])).toEqual([
      ["React", 20.2, false],
      ["Node.js", 6.6, true],
    ]);
    expect(right.map((r) => [r.name, r.size, r.noise])).toEqual([["Agile", 11.2, false]]);
  });

  it("categorías ordenadas por nº de tecnologías y luego por nombre", () => {
    const skills = [skill("A", 1, "cloud"), skill("B", 1, "language"), skill("C", 1, "language"), skill("D", 1, null), skill("E", 1, "ai")];
    expect(categoriesOf(skills)).toEqual(["language", "ai", "cloud"]);
  });
});

const trend = (name: string, series: Array<[string, number, number]>): SkillTrend => ({
  skill: { name, category: "language" },
  interval: "month",
  series: series.map(([period, jobs, mentions]) => ({ period, jobs, mentions, pct: (100 * mentions) / jobs })),
});

describe("tendencias", () => {
  it("une series con periodos distintos, ordenadas, sin inventar datos", () => {
    const rows = mergeTrends([
      trend("React", [["2026-10-01", 20, 10], ["2026-09-01", 4, 1]]),
      trend("Azure", [["2026-10-01", 20, 2], ["2026-11-01", 5, 0]]),
    ]);
    expect(rows.map((r) => r.period)).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
    expect(rows[0]?.React).toBe(25);
    expect(rows[0]?.Azure).toBeUndefined(); // Azure no tiene dato en septiembre
    expect(rows[2]?.detail.Azure).toEqual({ pct: 0, mentions: 0, jobs: 5 });
    expect(lastIndexWithValue(rows, "React")).toBe(1);
    expect(lastIndexWithValue(rows, "Azure")).toBe(2);
    expect(lastIndexWithValue(rows, "Nada")).toBe(-1);
  });

  it("selección: máximo 3, sin duplicados y cada tecnología conserva su color", () => {
    let sel = addSelected([], "A");
    sel = addSelected(sel, "B");
    sel = addSelected(sel, "B"); // duplicado: no cambia
    sel = addSelected(sel, "C");
    sel = addSelected(sel, "D"); // cuarta: no entra
    expect(sel).toEqual([{ name: "A", slot: 1 }, { name: "B", slot: 2 }, { name: "C", slot: 3 }]);
    sel = removeSelected(sel, "A");
    expect(sel.find((s) => s.name === "B")?.slot).toBe(2); // B no cambia de color
    sel = addSelected(sel, "E");
    expect(sel.find((s) => s.name === "E")?.slot).toBe(1); // E ocupa el hueco libre
  });

  it("eje Y con marcas redondas", () => {
    const rows = (pct: number) => mergeTrends([trend("X", [["2026-10-01", 100, pct]])]);
    expect(yAxisScale(rows(12.3), ["X"])).toEqual({ max: 20, ticks: [0, 5, 10, 15, 20] });
    expect(yAxisScale(rows(50), ["X"])).toEqual({ max: 50, ticks: [0, 10, 20, 30, 40, 50] });
    expect(yAxisScale(rows(52), ["X"])).toEqual({ max: 60, ticks: [0, 20, 40, 60] });
    expect(yAxisScale(rows(0), ["X"])).toEqual({ max: 10, ticks: [0, 5, 10] });
    expect(LOW_SAMPLE).toBe(10);
  });
});
