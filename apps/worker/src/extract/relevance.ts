const TECH_CATEGORY_HINTS = [
  "software",
  "information technology",
  "artificial intelligence",
  "devops",
  "sysadmin",
  "data",
  "engineering",
  "programming",
  "developer",
  "machine learning",
  "cyber",
  "security",
  "qa",
];

const TECH_TITLE_RE =
  /\b(developer|programmer|software|devops|sre|site reliability|full[- ]?stack|front[- ]?end|back[- ]?end|data (engineer|scientist|analyst)|machine learning|ml engineer|qa engineer|test automation|cloud engineer|platform engineer|security engineer|solutions? architect|engineering manager)\b/i;

export interface RelevanceInput {
  title: string;
  category: string | null;
  tags: string[];
  skills: string[];
}

/**
 * ¿Es una oferta de tecnología? Cualquiera de estas señales basta:
 *  - la categoría o etiquetas de la fuente apuntan a tecnología,
 *  - el título es de un rol técnico,
 *  - la descripción menciona al menos 2 skills del catálogo (una sola puede ser casualidad, p. ej. "Excel/SQL").
 */
export function isTechJob({ title, category, tags, skills }: RelevanceInput): boolean {
  const labels = [category ?? "", ...tags].map((s) => s.toLowerCase());
  if (labels.some((label) => TECH_CATEGORY_HINTS.some((hint) => label.includes(hint)))) return true;
  if (TECH_TITLE_RE.test(title)) return true;
  return skills.length >= 2;
}
