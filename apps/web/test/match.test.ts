import { describe, expect, it } from "vitest";
import { MAX_PROFILE, canonicalNames, matchHeadline, mergeSkills, removeSkill, splitSkills } from "../src/lib/match";

describe("splitSkills", () => {
  it("admite comas, punto y coma y saltos de línea, y limpia espacios y vacíos", () => {
    expect(splitSkills("react, Node.js;  TypeScript\nGo,, ,")).toEqual(["react", "Node.js", "TypeScript", "Go"]);
    expect(splitSkills("   ")).toEqual([]);
  });

  it("descarta nombres de más de 60 caracteres (la API los rechazaría con un 400)", () => {
    expect(splitSkills(`React, ${"x".repeat(61)}`)).toEqual(["React"]);
  });

  it("no parte nombres que llevan símbolos propios", () => {
    expect(splitSkills("C++, C#, .NET, CI/CD")).toEqual(["C++", "C#", ".NET", "CI/CD"]);
  });
});

describe("mergeSkills / removeSkill", () => {
  it("no repite sin distinguir mayúsculas y conserva la primera grafía", () => {
    expect(mergeSkills(["React"], ["react", "REACT", "Go", "go"])).toEqual(["React", "Go"]);
  });

  it("respeta el máximo de la API", () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`);
    expect(mergeSkills([], many)).toHaveLength(MAX_PROFILE);
    expect(mergeSkills(["a"], ["b", "c"], 2)).toEqual(["a", "b"]);
  });

  it("quitar tampoco distingue mayúsculas", () => {
    expect(removeSkill(["React", "Go"], "react")).toEqual(["Go"]);
    expect(removeSkill(["React"], "Nada")).toEqual(["React"]);
  });
});

describe("canonicalNames", () => {
  it("traduce lo escrito al nombre del catálogo", () => {
    const m = canonicalNames(["React", "Node.js"]);
    expect(m.get("react")).toBe("React");
    expect(m.get("node.js")).toBe("Node.js");
    expect(m.get("vue")).toBeUndefined();
  });
});

describe("matchHeadline: el tramo más exigente en el que hay ofertas", () => {
  const s = (over: Partial<Parameters<typeof matchHeadline>[0]>) => ({ considered: 100, withAnyMatch: 0, atLeast50: 0, atLeast75: 0, full: 0, ...over });

  it("con ofertas cubiertas del todo", () => {
    expect(matchHeadline(s({ full: 12, atLeast75: 30, atLeast50: 60, withAnyMatch: 80 }))).toBe("Ya cubres todo lo que piden 12 ofertas");
    expect(matchHeadline(s({ full: 1, withAnyMatch: 5 }))).toBe("Ya cubres todo lo que piden 1 oferta");
  });

  it("sin ninguna completa, baja de tramo", () => {
    expect(matchHeadline(s({ atLeast75: 3, atLeast50: 9, withAnyMatch: 20 }))).toBe("Estás cerca: cubres tres cuartas partes o más de lo que piden 3 ofertas");
    expect(matchHeadline(s({ atLeast50: 1, withAnyMatch: 4 }))).toBe("Ya cubres la mitad o más de lo que piden 1 oferta");
  });

  it("si nada llega a la mitad, o nada coincide, lo dice sin adornos", () => {
    expect(matchHeadline(s({ withAnyMatch: 7 }))).toBe("Encajas en algo, pero ninguna oferta llega a la mitad");
    expect(matchHeadline(s({}))).toBe("Ninguna oferta menciona estas tecnologías");
  });
});
