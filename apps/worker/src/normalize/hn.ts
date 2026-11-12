import { parseSalary, type ParsedSalary } from "../extract/salary.js";
import { htmlToText } from "../lib/html.js";
import type { HnComment } from "../sources/hn.js";
import type { NormalizedJob } from "../types.js";

/**
 * Los comentarios de "Who is hiring?" son texto libre, pero casi todos siguen la convención de una primera
 * línea separada por "|": `Empresa | Rol | Ubicación | Remoto | Tipo | Salario`. El ORDEN varía, faltan campos
 * y a veces faltan los pipes, así que clasificamos cada segmento por su contenido, no por su posición
 * (salvo la empresa, que es siempre el primero). Es una heurística: prioriza no inventar datos y deja
 * en null lo que no reconoce.
 */

const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;

const ROLE_RE =
  /\b(?:engineers?|engineering|developers?|programmers?|designers?|architects?|scientists?|analysts?|managers?|directors?|devops|sre|leads?|cto|vp|head of|founders?|founding|researchers?|specialists?|administrators?|sysadmin|recruiters?|consultants?|testers?|qa|swe|expert|associates?|executive|representative|coordinator|officer|assistant|accountant|writer|technician|product|support|sales|marketing|full[- ]?stack|front[- ]?end|back[- ]?end)\b/i;

const MULTIPLE_RE = /\b(?:multiple|various|several|many)\s+(?:\w+\s+)?(?:roles?|positions?|openings?|jobs?)\b/i;

const JOB_TYPES: { re: RegExp; value: string }[] = [
  { re: /\b(?:full[- ]?time|ft|permanent)\b/i, value: "full_time" },
  { re: /\b(?:part[- ]?time|pt)\b/i, value: "part_time" },
  { re: /\b(?:contract(?:or)?|contracting)\b/i, value: "contract" },
  { re: /\bfreelance\b/i, value: "freelance" },
  { re: /\bintern(?:ship)?s?\b/i, value: "internship" },
];

const MARKER_RE = /\b(?:remote|onsite|on-site|on site|hybrid|wfh|work from home|in[- ]office|anywhere)\b/i;
const MARKER_ONLY_RE = /^(?:fully |100% )?(?:remote|onsite|on-site|on site|hybrid|wfh|in[- ]office)$/i;
const NOT_REMOTE_RE = /\b(?:no remote|not remote|non[- ]remote|remote is not|(?:on-?site|in[- ]office) only)\b/i;

/** Segmentos de relleno que no aportan ubicación ni rol. */
const FILLER_RE = /\b(?:visa|relocation|sponsorship|equity|benefits)\b/i;
/** Palabras que delatan que un segmento NO es un lugar ("Series B", "SaaS B2B", "AI Industry"...). */
const NOT_A_PLACE_RE =
  /\b(?:series|seed|funding|funded|startup|saas|equity|inc|llc|ltd|ai|b2b|b2c|hiring|salary|apply|benefits|multiple|industry|platform|shop|agency|studio|consultancy|consulting|firm|company|software|tech|dev)\b/i;

/** "SEEKING FREELANCER | Devops Engineer | ...": ese primer segmento es una etiqueta, no una empresa. */
const SEEKING_RE = /^(?:seeking|looking for)\b|^freelancers?\s+(?:wanted|needed)\b/i;
/** "Roles: Engineering Manager", "Hiring: Backend Engineer"... */
const ROLE_PREFIX_RE = /^(?:roles?|positions?|hiring|openings?|jobs?)\s*:\s*/i;
const stripRolePrefix = (s: string) => s.replace(ROLE_PREFIX_RE, "").trim() || s;

const SALARY_HINT_RE = /[$€£]|\b(?:usd|eur|gbp|cad|aud|chf)\b|\d\s?k\b/i;

/** Cuando falta un pipe, la descripción queda pegada a la ubicación: "Paris or Remote (Europe) We are building...". */
const trimTrailingSentence = (s: string) =>
  s.replace(/\s+(?:we|we're|we are|our|join|looking|building)\b.*$/i, "").trim() || s;

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export interface HnHeader {
  company: string | null;
  role: string | null;
  multipleRoles: boolean;
  jobType: string | null;
  location: string | null;
  isRemote: boolean;
  salary: ParsedSalary;
}

/** ¿Es una cabecera de oferta? Exigimos al menos 2 pipes: filtra comentarios de meta y respuestas sueltas. */
export const looksLikeJobHeader = (line: string): boolean => (line.match(/\|/g)?.length ?? 0) >= 2;

function isPlaceLike(segment: string): boolean {
  return (
    segment.length <= 50 &&
    /^[A-ZÁÉÍÓÚÑ]/.test(segment) &&
    !/\d/.test(segment) &&
    !NOT_A_PLACE_RE.test(segment) &&
    !FILLER_RE.test(segment)
  );
}

export function parseHnHeader(line: string): HnHeader {
  const segments = line
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  // La empresa es el primer segmento (si es solo una URL, el siguiente). Quitamos "(Series A)", "(YC W21)"...
  const seeking = SEEKING_RE.test(segments[0] ?? "");
  const companyIndex = seeking ? -1 : segments.findIndex((s) => !URL_RE.test(s));
  const companyRaw = companyIndex >= 0 ? segments[companyIndex]! : null;
  const company = companyRaw ? clip(companyRaw.replace(/\s*\([^)]*\)\s*$/, "").trim() || companyRaw, 120) : null;
  const rest = seeking ? segments.slice(1) : companyIndex >= 0 ? segments.filter((_, i) => i !== companyIndex) : [];

  let salary: ParsedSalary = { min: null, max: null, currency: null };
  let role: string | null = null;
  let multipleRoles = false;
  const markers: string[] = [];
  const leftovers: string[] = [];

  for (const seg of rest) {
    if (URL_RE.test(seg)) continue;

    if (SALARY_HINT_RE.test(seg)) {
      const parsed = parseSalary(seg);
      if (parsed.min !== null) {
        if (salary.min === null) salary = parsed;
        continue;
      }
    }
    if (MULTIPLE_RE.test(seg)) {
      multipleRoles = true;
      continue;
    }
    if (role === null && seg.length <= 80 && ROLE_RE.test(seg)) {
      role = stripRolePrefix(seg);
      continue;
    }
    if (seg.length <= 30 && JOB_TYPES.some((t) => t.re.test(seg)) && !MARKER_RE.test(seg)) continue;
    if (FILLER_RE.test(seg)) continue;
    if (MARKER_RE.test(seg)) {
      markers.push(seg);
      continue;
    }
    leftovers.push(seg);
  }

  // Sin rol reconocible: si justo después de la empresa viene un segmento que no es marcador, salario ni URL
  // y aún quedan otros candidatos, lo más probable es que sea el rol ("Empresa | Account Executive | Madrid").
  // Con un solo candidato lo dejamos como lugar ("Shepherd | ONSITE | San Francisco, CA").
  const firstNonUrl = rest.find((s) => !URL_RE.test(s));
  if (role === null && leftovers.length >= 2 && leftovers[0] === firstNonUrl) {
    role = stripRolePrefix(leftovers.shift()!);
  }

  // Tipo de contrato: la coincidencia que aparece primero en la cabecera (sin contar la empresa).
  const body = rest.join(" | ");
  const jobType =
    JOB_TYPES.map((t) => ({ value: t.value, index: body.search(t.re) }))
      .filter((m) => m.index >= 0)
      .sort((a, b) => a.index - b.index)[0]?.value ?? null;

  const markerDetail = markers.find((m) => !MARKER_ONLY_RE.test(m));
  const markerOnly = markers.find((m) => MARKER_ONLY_RE.test(m));
  const place = leftovers.find(isPlaceLike);
  const locationRaw = place ?? markerDetail ?? markerOnly ?? null;

  const isRemote = MARKER_RE.test(body) && /\b(?:remote|wfh|work from home|anywhere)\b/i.test(body) && !NOT_REMOTE_RE.test(body);

  return {
    company,
    role,
    multipleRoles,
    jobType,
    location: locationRaw ? clip(trimTrailingSentence(locationRaw), 80) : null,
    isRemote,
    salary,
  };
}

/** Si la cabecera no trae rol, lo buscamos en las primeras líneas del cuerpo ("1. Senior Platform Engineer | 160k"). */
function roleFromBody(lines: string[]): string | null {
  for (const raw of lines.slice(1, 7)) {
    const line = raw.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").split("|")[0]!.trim();
    if (line.length > 0 && line.length <= 100 && ROLE_RE.test(line)) return stripRolePrefix(line);
  }
  return null;
}

/** HN usa `<p>` sin cerrar para separar párrafos: lo convertimos en saltos de línea ANTES de limpiar el HTML. */
export const hnHtmlToText = (html: string): string | null => htmlToText(html.replace(/<p>/gi, "\n\n"));

/** Devuelve null si el comentario no parece una oferta (sin cabecera con pipes, meta, etc.). */
export function normalizeHnComment(comment: HnComment): NormalizedJob | null {
  const text = hnHtmlToText(comment.html);
  if (!text) return null;

  const lines = text.split("\n").map((l) => l.trim());
  const headerLine = lines.find((l) => l !== "") ?? "";
  if (!looksLikeJobHeader(headerLine)) return null;

  const header = parseHnHeader(headerLine);

  const title =
    header.role ??
    roleFromBody(lines) ??
    (header.multipleRoles ? "Multiple roles" : null) ??
    (header.company ? `${header.company} (Hacker News)` : "Hacker News job post");

  return {
    source: "hn",
    externalId: comment.id,
    title: clip(title, 200),
    company: header.company,
    category: null,
    tags: [`hn:${comment.thread.month}`],
    jobType: header.jobType,
    location: header.location,
    isRemote: header.isRemote,
    salaryMin: header.salary.min,
    salaryMax: header.salary.max,
    salaryCurrency: header.salary.currency,
    description: text,
    url: `https://news.ycombinator.com/item?id=${comment.id}`,
    postedAt: comment.createdAt,
    // Guardamos el comentario original (sin las respuestas) para poder reprocesarlo sin volver a llamar a la API.
    raw: {
      id: comment.id,
      author: comment.author,
      html: comment.html,
      created_at: comment.createdAt?.toISOString() ?? null,
      thread_id: comment.thread.id,
      thread_title: comment.thread.title,
    },
  };
}
