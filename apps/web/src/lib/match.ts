import type { MatchSummary } from "../api/types";
import { fmtInt } from "./format";

/** Mismo límite que la API (`/match?skills=` admite hasta 30). */
export const MAX_PROFILE = 30;
/** La API rechaza nombres de más de 60 caracteres. */
const MAX_NAME = 60;

/** "react, Node.js;  TypeScript" → ["react", "Node.js", "TypeScript"]. Admite coma, punto y coma y saltos de línea. */
export function splitSkills(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_NAME);
}

/** Añade sin repetir (sin distinguir mayúsculas; se conserva la primera grafía) y sin pasar del máximo. */
export function mergeSkills(current: string[], added: string[], max = MAX_PROFILE): string[] {
  const out = [...current];
  const seen = new Set(out.map((s) => s.toLowerCase()));
  for (const name of added) {
    if (out.length >= max) break;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

export const removeSkill = (list: string[], name: string): string[] => list.filter((s) => s.toLowerCase() !== name.toLowerCase());

/** Nombre del catálogo para cada nombre escrito por el usuario ("react" → "React"), según lo que reconoció la API. */
export function canonicalNames(recognized: string[]): Map<string, string> {
  return new Map(recognized.map((n) => [n.toLowerCase(), n]));
}

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** Titular escrito por el dato: el tramo más exigente en el que hay ofertas. */
export function matchHeadline(s: MatchSummary): string {
  if (s.full > 0) return `Ya cubres todo lo que piden ${plural(s.full, "oferta", "ofertas")}`;
  if (s.atLeast75 > 0) return `Estás cerca: cubres tres cuartas partes o más de lo que piden ${plural(s.atLeast75, "oferta", "ofertas")}`;
  if (s.atLeast50 > 0) return `Ya cubres la mitad o más de lo que piden ${plural(s.atLeast50, "oferta", "ofertas")}`;
  if (s.withAnyMatch > 0) return "Encajas en algo, pero ninguna oferta llega a la mitad";
  return "Ninguna oferta menciona estas tecnologías";
}
