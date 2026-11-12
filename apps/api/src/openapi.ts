import { OpenApiGeneratorV3, type OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

export function buildOpenApi(registry: OpenAPIRegistry) {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Tech Job Tracker API",
      version: "0.1.0",
      description:
        "API de solo lectura sobre ofertas de empleo tecnológico recolectadas de Remotive, Arbeitnow y Hacker News " +
        "('Who is hiring?'). Expone qué tecnologías se piden, cómo evolucionan y en qué se diferencian las fuentes.\n\n" +
        "**Atribución:** cada oferta incluye `url` hacia su publicación original; cualquier uso público debe mantener " +
        "ese enlace y citar la fuente. Los datos de Remotive llegan con 24 horas de retraso.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Tecnologías", description: "Ranking, tendencias y combinaciones de tecnologías." },
      { name: "Ofertas", description: "Búsqueda y detalle de ofertas." },
      { name: "Mi match", description: "Qué ofertas encajan con las tecnologías que ya conoces y qué aprender después." },
      { name: "Estadísticas", description: "Resúmenes y comparación entre fuentes." },
      { name: "Sistema", description: "Estado del servicio." },
    ],
  });
}
