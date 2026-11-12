export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
}

const EMPTY: ParsedSalary = { min: null, max: null, currency: null };

const SYMBOL_TO_CURRENCY: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };
const CODE_RE = /\b(USD|EUR|GBP|CAD|AUD|CHF)\b/i;

/** Convierte "40k", "40,5k" o "40,000" en un número entero. */
function toNumber(raw: string, hasK: boolean): number | null {
  const cleaned = raw.replace(/\s/g, "");
  let value: number;
  if (hasK) {
    // "40k" o "40.5k" / "40,5k"
    value = parseFloat(cleaned.replace(",", ".")) * 1000;
  } else {
    // "40,000" o "40.000" (separador de miles) => quitar separadores
    value = parseFloat(cleaned.replace(/[.,](?=\d{3}(\D|$))/g, ""));
  }
  return Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Interpreta textos de salario como "$40,000 - $50,000", "€60k-80k" o "USD 90000".
 * Solo devuelve datos si el monto parece un salario anual (>= 10 000); en otro caso
 * (p. ej. "$25/hour") devuelve vacío para no contaminar las estadísticas.
 */
export function parseSalary(text: string | null | undefined): ParsedSalary {
  if (!text) return EMPTY;
  if (/\b(hour|hr|hora|day|week|month|mes)\b|\/\s*(h|hr|hour|day|month|mo)\b/i.test(text)) return EMPTY;

  const symbol = Object.keys(SYMBOL_TO_CURRENCY).find((s) => text.includes(s));
  const code = text.match(CODE_RE)?.[1]?.toUpperCase();
  const currency = code ?? (symbol ? SYMBOL_TO_CURRENCY[symbol]! : null);

  const matches = [...text.matchAll(/(\d[\d.,]*)\s*(k)?/gi)];
  const numbers: number[] = [];
  for (const m of matches) {
    const hasK = Boolean(m[2]);
    const n = toNumber(m[1]!.replace(/[.,]+$/, ""), hasK);
    if (n !== null) numbers.push(n);
  }

  // En "60k-80k" el primer número no lleva 'k' explícita pero comparte la escala del segundo.
  if (numbers.length === 2 && /\dk\b/i.test(text.replace(/\s/g, ""))) {
    const [a, b] = numbers as [number, number];
    if (a < 1000 && b >= 1000) numbers[0] = a * 1000;
  }

  const valid = numbers.filter((n) => n >= 10_000 && n <= 10_000_000);
  if (valid.length === 0) return EMPTY;

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return { min, max, currency };
}
