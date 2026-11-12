import { z } from "zod";

/** Remotive recomienda máximo 4 peticiones al día => una cada 6 horas como mínimo. Aplicamos lo mismo a todas las fuentes. */
export const MIN_INTERVAL_HOURS = 6;

export const SOURCE_NAMES = ["remotive", "arbeitnow", "hn"] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

const boolFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const sourcesSchema = z
  .string()
  .default(SOURCE_NAMES.join(","))
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(z.enum(SOURCE_NAMES), {
        error: `SOURCES solo admite: ${SOURCE_NAMES.join(", ")}`,
      })
      .min(1, { message: "SOURCES debe incluir al menos una fuente" }),
  );

const envSchema = z.object({
  DATABASE_URL: z.string().url({ message: "DATABASE_URL debe ser una URL de PostgreSQL válida" }),
  SOURCES: sourcesSchema,
  REMOTIVE_CATEGORY: z.string().min(1).default("software-dev"),
  ARBEITNOW_MAX_PAGES: z.coerce.number().int().min(1).max(20).default(5),
  /** Hilos mensuales de "Who is hiring?" a recorrer (1 = solo el más reciente; hasta 12 para cargar histórico). */
  HN_THREADS: z.coerce.number().int().min(1).max(12).default(1),
  ETL_INTERVAL_HOURS: z.coerce
    .number()
    .min(MIN_INTERVAL_HOURS, {
      message: `ETL_INTERVAL_HOURS debe ser >= ${MIN_INTERVAL_HOURS} (límite de la API de Remotive)`,
    })
    .default(MIN_INTERVAL_HOURS),
  RUN_ONCE: boolFromString,
  FORCE_RUN: boolFromString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuración inválida:\n${problems}`);
  }
  return parsed.data;
}
