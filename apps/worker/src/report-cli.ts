import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import {
  compareSources,
  DEFAULT_MIN_TECH_JOBS,
  formatComparison,
  formatSkillTable,
  getSkillShares,
  rankSkills,
} from "./report.js";

const USAGE = `Uso: report [opciones]

  --limit <n>            Cuántas tecnologías mostrar (por defecto 20)
  --sort <modo>          balanced (por defecto) | total | <nombre de una fuente, p. ej. hn>
  --compare <a,b>        Compara dos fuentes: qué piden más una que la otra (p. ej. hn,arbeitnow)
  --min-jobs <n>         Mínimo de ofertas tecnológicas para que una fuente cuente en "balanced" (por defecto ${DEFAULT_MIN_TECH_JOBS})
  --help                 Muestra esta ayuda`;

const toInt = (value: string | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} debe ser un entero positivo (recibí '${value}')`);
  return n;
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      sort: { type: "string" },
      compare: { type: "string" },
      "min-jobs": { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const limit = toInt(values.limit, 20, "--limit");
  const minTechJobs = toInt(values["min-jobs"], DEFAULT_MIN_TECH_JOBS, "--min-jobs");

  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    const data = await getSkillShares(pool);
    if (data.skills.length === 0) {
      console.log("Todavía no hay ofertas tecnológicas con tecnologías detectadas. Ejecuta primero el worker.");
      return;
    }

    const summary = data.sources.map((s) => `${s.source}: ${s.techJobs} tecnológicas de ${s.jobs}`).join(" · ");
    console.log(`Ofertas — ${summary}\n`);

    if (values.compare) {
      const [a, b, ...extra] = values.compare.split(",").map((s) => s.trim());
      if (!a || !b || extra.length > 0) throw new Error("--compare necesita exactamente dos fuentes separadas por coma, p. ej. --compare hn,arbeitnow");
      console.log(formatComparison(compareSources(data, a, b, { limit: Math.min(limit, 15) })));
    } else {
      const ranked = rankSkills(data, values.sort ?? "balanced", minTechJobs).slice(0, limit);
      console.log(formatSkillTable(data, ranked, { minTechJobs }));
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // 42P01 = la tabla no existe: el worker todavía no ha creado el esquema.
  const tablesMissing = typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
  console.error(
    tablesMissing
      ? "La base de datos todavía no tiene tablas. Arranca primero el worker (aplica las migraciones y descarga las ofertas)."
      : err instanceof Error
        ? err.message
        : String(err),
  );
  process.exitCode = 1;
});
