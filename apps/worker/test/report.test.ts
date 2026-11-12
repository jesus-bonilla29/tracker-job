import { describe, expect, it } from "vitest";
import {
  compareSources,
  formatComparison,
  formatSkillTable,
  rankSkills,
  type SkillShare,
  type SkillShares,
} from "../src/report.js";

// big: fuente grande · small: fuente mediana · tiny: muestra muy pequeña (menos de 20 ofertas tecnológicas)
const TECH = { big: 1000, small: 100, tiny: 5 };

const skill = (name: string, counts: Partial<Record<keyof typeof TECH, number>>): SkillShare => {
  const bySource: SkillShare["bySource"] = {};
  let total = 0;
  for (const [src, count] of Object.entries(counts)) {
    const tech = TECH[src as keyof typeof TECH];
    bySource[src] = { count: count!, pct: Math.round((1000 * count!) / tech) / 10 };
    total += count!;
  }
  return { skill: name, category: null, total, bySource };
};

const data: SkillShares = {
  sources: [
    { source: "big", jobs: 1400, techJobs: TECH.big },
    { source: "small", jobs: 150, techJobs: TECH.small },
    { source: "tiny", jobs: 12, techJobs: TECH.tiny },
  ],
  skills: [
    skill("Python", { big: 500, small: 20, tiny: 1 }), // 50 % / 20 %   -> media 35, total 521
    skill("TypeScript", { big: 100, small: 70 }), //      10 % / 70 %   -> media 40, total 170
    skill("Rust", { big: 5, small: 1 }), //                0.5 % / 1 %   -> poco frecuente
    skill("Elixir", { tiny: 3 }), //                       solo en la muestra pequeña
  ],
};

describe("rankSkills", () => {
  it("por defecto da el mismo peso a cada fuente fiable, así que la fuente grande no manda", () => {
    const names = rankSkills(data).map((s) => s.skill);
    expect(names[0]).toBe("TypeScript"); // media 40 > media 35 de Python
    expect(names[1]).toBe("Python");
  });

  it("'total' ordena por número absoluto de ofertas (lo domina la fuente grande)", () => {
    expect(rankSkills(data, "total").map((s) => s.skill)).toEqual(["Python", "TypeScript", "Rust", "Elixir"]);
  });

  it("una fuente con muestra pequeña no entra en la media 'balanced'", () => {
    // Elixir solo existe en 'tiny' (60 %): con la media sobre big+small vale 0 y queda último.
    expect(rankSkills(data).at(-1)!.skill).toBe("Elixir");
    // Si se baja el mínimo para que 'tiny' cuente, Elixir sube por encima de Rust.
    const lowBar = rankSkills(data, "balanced", 1).map((s) => s.skill);
    expect(lowBar.indexOf("Elixir")).toBeLessThan(lowBar.indexOf("Rust"));
  });

  it("puede ordenar por el porcentaje de una fuente concreta", () => {
    expect(rankSkills(data, "small")[0]!.skill).toBe("TypeScript");
    expect(rankSkills(data, "big")[0]!.skill).toBe("Python");
  });

  it("falla con un mensaje claro ante una fuente desconocida", () => {
    expect(() => rankSkills(data, "linkedin")).toThrow(/Fuente desconocida 'linkedin'.*big, small, tiny/);
  });

  it("si ninguna fuente alcanza el mínimo, cae al orden por total en vez de devolver ceros", () => {
    expect(rankSkills(data, "balanced", 5000)[0]!.skill).toBe("Python");
  });
});

describe("compareSources", () => {
  const cmp = compareSources(data, "big", "small", { minMentions: 5 });

  it("separa lo más típico de cada fuente, ordenado por diferencia en puntos porcentuales", () => {
    expect(cmp.moreInA.map((d) => [d.skill, d.diff])).toEqual([["Python", 30]]);
    expect(cmp.moreInB.map((d) => [d.skill, d.diff])).toEqual([["TypeScript", -60], ["Rust", -0.5]]);
  });

  it("descarta tecnologías con muy pocas menciones entre las dos fuentes", () => {
    // Rust: 5 + 1 = 6 menciones (se queda). Con un mínimo de 7 desaparece.
    expect(compareSources(data, "big", "small", { minMentions: 7 }).moreInB.map((d) => d.skill)).toEqual(["TypeScript"]);
  });

  it("respeta el límite", () => {
    expect(compareSources(data, "big", "small", { limit: 1, minMentions: 1 }).moreInB).toHaveLength(1);
  });

  it("falla con un mensaje claro si una fuente no existe", () => {
    expect(() => compareSources(data, "big", "nope")).toThrow(/Fuente desconocida 'nope'/);
  });
});

describe("formato de texto", () => {
  it("la tabla muestra porcentajes, '-' donde la fuente no menciona la tecnología y avisa de las muestras pequeñas", () => {
    const text = formatSkillTable(data, rankSkills(data));
    expect(text).toContain("Tecnología");
    expect(text).toContain("big (1000)");
    expect(text).toContain("tiny* (5)");
    expect(text).toMatch(/TypeScript\s+170\s+10\.0%\s+70\.0%\s+-/);
    expect(text).toContain("* Menos de 20 ofertas tecnológicas");
  });

  it("no añade la nota al pie si todas las fuentes tienen muestra suficiente", () => {
    const ok: SkillShares = { sources: data.sources.slice(0, 2), skills: data.skills.slice(0, 2) };
    expect(formatSkillTable(ok, ok.skills)).not.toContain("*");
  });

  it("la comparación muestra el signo de la diferencia", () => {
    const text = formatComparison(cmp());
    expect(text).toContain("Más típicas de 'big' que de 'small'");
    expect(text).toMatch(/Python\s+50\.0%\s+20\.0%\s+\+30\.0/);
    expect(text).toMatch(/TypeScript\s+10\.0%\s+70\.0%\s+-60\.0/);
  });

  function cmp() {
    return compareSources(data, "big", "small", { minMentions: 5 });
  }
});
