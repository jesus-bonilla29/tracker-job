import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url({ message: "DATABASE_URL debe ser una URL de PostgreSQL válida" }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Orígenes permitidos por CORS, separados por comas. "*" permite cualquiera (la API es de solo lectura y sin cookies). */
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  /** Peticiones por minuto y por IP. 0 desactiva el límite. */
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(0).default(120),
  /**
   * Cuántos proxies de confianza hay delante de la API (0 = ninguno, el cliente se conecta directo).
   * Con nginx delante pon 1: así el límite de peticiones se aplica a la IP real del visitante y no a la del proxy.
   * Con un valor mayor que el real, un cliente podría falsear su IP con la cabecera X-Forwarded-For y esquivar el límite.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** Cuánto pueden cachear las respuestas los clientes. Los datos cambian como mucho cada pocas horas. */
  CACHE_SECONDS: z.coerce.number().int().min(0).default(60),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida:\n${problems}`);
  }
  return parsed.data;
}

export const parseCorsOrigins = (value: string): string[] | "*" => {
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  return items.includes("*") ? "*" : items;
};
