import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/** apps/worker/{src|dist}/extract  ->  raíz del repo  ->  data/skills.json */
export const DEFAULT_SKILLS_FILE = path.resolve(import.meta.dirname, "../../../../data/skills.json");

const skillSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  /** Alias que se buscan sin distinguir mayúsculas y sin condiciones: "typescript", "node.js". */
  aliases: z.array(z.string().min(1)).default([]),
  /** Alias que SOLO cuentan con esa capitalización exacta: "SQL", "Java", "Rust". */
  exact: z.array(z.string().min(1)).default([]),
  /**
   * Alias ambiguos (palabras comunes del inglés): "Go", "R", "React", "Swift", "Spark".
   * Distinguen mayúsculas y solo cuentan si la oferta ya tiene al menos una skill "fuerte".
   * Así "Go to market" en una oferta de ventas no suma Go, pero "Python, Go, Kubernetes" sí.
   */
  weak: z.array(z.string().min(1)).default([]),
  /**
   * Palabras que, si siguen a un alias débil, indican uso común del inglés aunque la oferta sea técnica:
   * "Go to market", "Go beyond", "React quickly". Se comprueban tras espacios o guiones ("Go-to-market").
   */
  weakNotFollowedBy: z.array(z.string().min(1)).default([]),
});

export type SkillDefinition = z.infer<typeof skillSchema>;

export async function loadSkillDefinitions(file: string = DEFAULT_SKILLS_FILE): Promise<SkillDefinition[]> {
  const parsed = z.array(skillSchema).safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    throw new Error(
      `skills.json inválido: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const names = new Set<string>();
  for (const skill of parsed.data) {
    if (names.has(skill.name)) throw new Error(`skills.json: skill duplicada "${skill.name}"`);
    names.add(skill.name);
  }
  return parsed.data;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Una skill no puede estar pegada a letras, dígitos, guion bajo, +, #, . ni & por la izquierda ("ASP.NET" no cuenta
// como ".NET" suelto, "R&D" no cuenta como R)... Las letras se detectan con Unicode (\p{L}), no solo A-Z: en
// "Rückfragen", "Rémunération" o "BÄR" la R está pegada a una letra aunque sea con tilde (caso real en Arbeitnow).
const LEFT = "(?<![\\p{L}\\p{N}_+#.&])";
// ...ni a letras, +, # o & por la derecha ("Java" no está dentro de "JavaScript"). Permitimos dígitos
// ("Python3", "HTML5", "Java17") y punto final de frase ("We use React.").
const RIGHT = "(?![\\p{L}_+#&])";
// Las skills "débiles" son palabras o letras sueltas ("Go", "R"): ahí un dígito pegado NO es una versión sino otra
// cosa ("R2R", "UN R171", "R1"), así que también se rechaza.
const RIGHT_WEAK = "(?![\\p{L}\\p{N}_+#&])";

function buildRegex(words: string[], flags: string, notFollowedBy: string[] = [], weak = false): RegExp | null {
  if (words.length === 0) return null;
  const alternatives = [...words]
    .sort((a, b) => b.length - a.length) // los más largos primero
    .map((w) => escapeRegex(w.trim()).replace(/\s+/g, "\\s+"));
  // Las palabras bloqueadas se comparan sin distinguir mayúsculas ("Go To Market", "GO TO MARKET"), aunque la skill
  // en sí sea sensible a ellas: por eso cada letra pasa a clase [tT] en lugar de usar la bandera "i".
  const anyCase = (w: string) => escapeRegex(w).replace(/[A-Za-z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
  const blocked =
    notFollowedBy.length > 0 ? `(?![\\s-]+(?:${notFollowedBy.map(anyCase).join("|")})\\b)` : "";
  return new RegExp(`${LEFT}(?:${alternatives.join("|")})${weak ? RIGHT_WEAK : RIGHT}${blocked}`, `${flags}u`);
}

export type SkillExtractor = (text: string | null | undefined) => string[];

/** Compila el diccionario una vez y devuelve una función que extrae los nombres de skills de un texto. */
export function createSkillExtractor(definitions: SkillDefinition[]): SkillExtractor {
  const compiled = definitions.map((d) => ({
    name: d.name,
    insensitive: buildRegex(d.aliases, "i"),
    exact: buildRegex(d.exact, ""),
    weak: buildRegex(d.weak, "", d.weakNotFollowedBy, true),
  }));

  return (text) => {
    if (!text) return [];
    const strong = new Set<string>();
    const weak = new Set<string>();

    for (const c of compiled) {
      if (c.insensitive?.test(text) || c.exact?.test(text)) strong.add(c.name);
      else if (c.weak?.test(text)) weak.add(c.name);
    }

    if (strong.size > 0) for (const name of weak) strong.add(name);
    return [...strong].sort((a, b) => a.localeCompare(b));
  };
}
