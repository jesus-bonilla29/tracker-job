# Tech Job Tracker

Pipeline de datos que recolecta ofertas de empleo tech de varias fuentes, las normaliza, detecta las tecnologías
que piden y las guarda en PostgreSQL para analizar qué se demanda más y cómo cambian las tendencias.

> **Estado:** semana 5. Tres fuentes (**Remotive**, **Arbeitnow** y **Hacker News "Who is hiring?"**),
> extractor de skills (111 tecnologías), marca `is_tech`, **API REST documentada con Swagger** y **dashboard en React**, **"Mi match"** (qué ofertas encajan con tu perfil).
> Próximo paso: despliegue online y, más adelante, Redis.

## Stack

Node 22 · TypeScript · PostgreSQL 16 · Express 5 · Zod 4 · OpenAPI/Swagger · React 19 · Vite · Recharts · TanStack Query · nginx · Vitest + supertest + Testing Library · Docker Compose · GitHub Actions

## Cómo ejecutarlo

```bash
cp .env.example .env          # y cambia POSTGRES_PASSWORD (también en DATABASE_URL)
docker compose up --build     # PostgreSQL + worker + API + dashboard
```

El worker aplica las migraciones al arrancar, consulta cada fuente y repite cada 6 horas.
El **dashboard** queda en <http://localhost:8080>; la API en <http://localhost:3000> y su documentación interactiva en <http://localhost:3000/api/docs>.
Al primer arranque las gráficas estarán vacías hasta que el worker termine su primera ejecución (unos segundos).

Sin Docker (necesitas un PostgreSQL accesible en `DATABASE_URL`):

```bash
npm install
npm run dev --workspace @tjt/worker       # o RUN_ONCE=true para una sola ejecución
npm run dev --workspace @tjt/api          # API en http://localhost:3000
npm run dev --workspace @tjt/web          # dashboard en http://localhost:5173 (reenvía /api a la API)
```

Comprobar que se guardó algo:

```bash
# Estado de cada ejecución
docker compose exec db psql -U tjt -c "SELECT id, source, status, fetched, inserted, updated, skipped FROM etl_runs ORDER BY id DESC LIMIT 10"

# Tecnologías más pedidas (solo ofertas de tecnología)
docker compose exec db psql -U tjt -c "SELECT s.name, count(*) FROM job_skills js JOIN skills s ON s.id=js.skill_id JOIN jobs j ON j.id=js.job_id WHERE j.is_tech GROUP BY s.name ORDER BY 2 DESC LIMIT 15"
```

Comparar las fuentes entre sí. Las fuentes tienen volúmenes muy distintos (Arbeitnow ~1.500 ofertas frente a ~200 de HN),
así que el informe expresa cada tecnología como **porcentaje de las ofertas tecnológicas de su fuente** y no como conteo absoluto:

```bash
docker compose run --rm worker node apps/worker/dist/report-cli.js                      # ranking equilibrado, 20 tecnologías
docker compose run --rm worker node apps/worker/dist/report-cli.js --compare hn,arbeitnow   # qué pide más cada fuente
docker compose run --rm worker node apps/worker/dist/report-cli.js --sort total --limit 30  # conteo absoluto (lo domina la fuente grande)
# sin Docker:  npm run report --workspace @tjt/worker -- --compare hn,arbeitnow
```

Para interpretarlo: con ~100–200 ofertas por fuente, diferencias de pocos puntos porcentuales son ruido; fíjate en las grandes.
Las fuentes con menos de 20 ofertas tecnológicas se marcan con `*` y no cuentan en el orden por defecto.

Recalcular skills e `is_tech` de todo lo guardado (tras mejorar `data/skills.json`), sin llamar a ninguna API:

```bash
docker compose run --rm worker node apps/worker/dist/reprocess-cli.js
```

## Fuentes

| Fuente | Qué aporta | Notas |
|---|---|---|
| **Remotive** | Ofertas remotas | Máx. ~4 peticiones/día; el filtro de categoría de su API no es estricto. Requiere enlazar y citar la fuente. |
| **Arbeitnow** | Europa y remoto | Sin API key. Pagina con pausa entre páginas (`ARBEITNOW_MAX_PAGES`). No expone salarios. |
| **Hacker News** | Startups, texto libre | Buscador público de Algolia: 1 búsqueda + 1 petición por hilo mensual (`HN_THREADS`). |

### Hacker News: cómo se interpreta un comentario

Los comentarios de "Who is hiring?" son texto libre. La mayoría sigue la convención
`Empresa | Rol | Ubicación | Remoto | Tipo | Salario`, pero **el orden varía, faltan campos y a veces faltan los pipes**.
Por eso `normalize/hn.ts` clasifica cada segmento por su contenido y no por su posición (la empresa es siempre el primero).

- Un comentario sin cabecera de al menos 2 pipes (meta, respuestas sueltas) se descarta y cuenta como `skipped`.
- Lo que no se reconoce queda en `NULL` en vez de inventarse. Es una heurística, no un parser perfecto.
- **Límites conocidos:** cabeceras que usan `-` o `/` en lugar de `|` se descartan; "Remote" como opción
  ("Onsite or Remote") cuenta como remoto; "no Java needed" igual suma Java en el extractor de skills.
- `HN_THREADS=6` carga meses anteriores de una vez. Para tendencias usa `posted_at` (fecha del comentario) y no
  `first_seen_at` (momento en que lo descargaste), porque el histórico se descarga de golpe.

## API REST

Solo lectura (`GET`). Cada endpoint se define **una sola vez** con Zod y de esa definición salen la validación de los
parámetros, la documentación OpenAPI y (en las pruebas) la comprobación de que la respuesta real cumple lo documentado.

| Endpoint | Qué responde |
|---|---|
| `GET /api/skills/top` | Ranking de tecnologías (`source`, `category`, `from`, `to`, `limit`) con `%` sobre las ofertas tech filtradas |
| `GET /api/skills/{name}/trend` | Evolución por `week` o `month` (por fecha de publicación, UTC) |
| `GET /api/skills/{name}/cooccurrence` | Qué otras tecnologías se piden junto a esta |
| `GET /api/jobs` | Búsqueda paginada: `q`, `skills=React,TypeScript` (todas), `remote`, `hasSalary`, `source`, `from`/`to`, `sort` |
| `GET /api/jobs/{id}` | Detalle con descripción completa |
| `GET /api/match?skills=React,TypeScript` | Mi match: ofertas ordenadas por qué parte de lo que piden ya cubres, embudo de cobertura y `learnNext` (qué aprender para desbloquear más). Admite `source`, `remote`, `from`/`to`, `minSkills` (por defecto 3) y `limit` |
| `GET /api/sources/compare?a=hn&b=arbeitnow` | Qué tecnologías pide más cada fuente (puntos porcentuales) |
| `GET /api/stats/overview` | Totales y novedades de las últimas 24 h |
| `GET /api/health` | Estado de la base de datos y última ejecución del ETL por fuente |

```bash
curl "http://localhost:3000/api/skills/top?source=hn&limit=5"
curl "http://localhost:3000/api/jobs?skills=React,TypeScript&remote=true&pageSize=5"
curl "http://localhost:3000/api/skills/typescript/trend?interval=month"
```

Seguridad y robustez:

- SQL siempre parametrizado; los valores del usuario nunca se concatenan. La búsqueda `q` escapa los comodines de `LIKE`.
- Todo parámetro se valida (tipos, rangos, fechas reales, parámetros desconocidos rechazados) y los errores tienen un formato único.
- `helmet`, CORS con lista de orígenes (`CORS_ORIGIN`), límite de peticiones por IP (`RATE_LIMIT_PER_MIN`) y `statement_timeout` de 10 s.
- Los errores internos se registran en el servidor y **nunca** se envían al cliente. Base sin migrar o consulta lenta → `503`.
- Caché HTTP (`CACHE_SECONDS`) para datos; los errores y `/health` nunca se cachean.
- En Docker la API solo se publica en `127.0.0.1`. Si la expones, ponle delante un proxy con HTTPS.

Límites a tener presentes: los datos de Hacker News son pocos (~100–200 ofertas tech por mes), así que los porcentajes
por mes o por semana de una tecnología concreta son ruidosos; y las fuentes no son poblaciones equivalentes (los anuncios
de HN son cortos). La respuesta de `/sources/compare` incluye una nota al respecto.

## Dashboard

Cinco vistas, cada una con su estado en la URL (los filtros se pueden compartir y sobreviven a recargar):

| Vista | Qué responde |
|---|---|
| **Tecnologías** (`/`) | Ranking como % de las ofertas tech, por fuente y categoría. El titular lo escribe el dato ("Python aparece en 1 de cada 3 ofertas") |
| **Tendencias** (`/tendencias`) | Evolución de hasta 3 tecnologías por mes o semana. Un punto **hueco** marca un periodo con menos de 10 ofertas: el porcentaje no es fiable |
| **Fuentes** (`/fuentes`) | Qué pide más una fuente que otra, en puntos porcentuales. Las barras **atenuadas** son diferencias dentro del margen de ruido (≈ 9 pp con 121 frente a 1.008 ofertas) |
| **Ofertas** (`/ofertas`) | Búsqueda por texto y tecnologías (la oferta debe tener todas). Cada título enlaza a la publicación original |
| **Mi match** (`/mi-match`) | Escribe las tecnologías que conoces: cobertura de cada oferta (p. ej. "2 de 3 tecnologías que piden"), embudo (todo / ¾ / mitad) y "qué aprender después" |

Decisiones y cautelas:

- **Mi match es un cruce de listas, no una evaluación de ti.** La cobertura es `tecnologías que tienes ÷ tecnologías detectadas` en la
  oferta, solo cuenta ofertas tech con al menos 3 tecnologías detectadas, y las detectadas salen del texto: los anuncios largos
  (Arbeitnow) listan más tecnologías que los cortos (Hacker News) y tienden a puntuar menos. Compara fuentes por separado.
  "Qué aprender" cuenta las tecnologías que son la **única** que te falta en ofertas con ≥ 50 % de cobertura.

- **Honestidad estadística en la propia interfaz:** puntos huecos, barras atenuadas y avisos de "pocas ofertas" en lugar de dibujar
  ruido como si fuera tendencia. Una tendencia necesita varios periodos: para cargar meses anteriores de Hacker News sube `HN_THREADS`
  en `.env` (por ejemplo a 6) y reinicia el worker.
- **Mismo origen, sin CORS:** el navegador solo habla con nginx (o con el proxy de Vite en desarrollo), que reenvía `/api/*` a la API.
- **Seguridad:** CSP estricta (`script-src 'self'`, sin scripts en línea), nginx sin root, y los enlaces de las ofertas solo se
  construyen si la URL es `http(s)` (nunca `javascript:` ni `data:`). El límite de peticiones de la API cuenta la IP real del
  visitante (`TRUST_PROXY=1`); nginx sobrescribe `X-Forwarded-For`, así que no se puede falsear.
- **Accesible:** navegación por teclado, enlace "Saltar al contenido", filtros con controles nativos, tema claro/oscuro y la vista
  de tabla de las tendencias como alternativa al gráfico.
- Los datos se piden con TanStack Query (caché de 60 s, igual que la API) y todas las vistas tienen estado de carga, error con
  botón de reintento y estado vacío con instrucciones.

## Pruebas

```bash
npm run typecheck
npm test                                                    # unitarias (no necesitan base de datos)
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/tjt_test npm test   # + integración con PostgreSQL (worker y API)
```

> Las pruebas del dashboard (lógica estadística, cliente HTTP y vistas con la API simulada) no necesitan base de datos.
> Las pruebas de integración **borran el esquema `public`**: apunta `TEST_DATABASE_URL` a una base de pruebas, nunca a la real.
> Los fixtures de Arbeitnow y Hacker News son sintéticos (empresas inventadas) y siguen el formato documentado y los
> formatos reales observados; ninguna prueba toca la red.

## Arquitectura

```
Remotive ─┐
Arbeitnow ─┼─► sources/*.ts        (fetch con timeout + reintentos; validación con Zod por oferta)
HN/Algolia ┘        │
                    ▼
             normalize/*.ts        (formato común NormalizedJob; HTML → texto; salario → min/max/moneda)
                    │
                    ▼
               enrich.ts           (extract/skills.ts + extract/relevance.ts → skills e is_tech)
                    │
                    ▼
              db/jobs.ts           (UPSERT idempotente en una transacción)
                    │
                    ▼
                PostgreSQL         jobs · skills · job_skills · etl_runs
                    │
                    ▼
              apps/api             (Express 5 · Zod → validación + OpenAPI · SQL parametrizado)
                    │
                    ▼
        /api/* · /api/docs         (JSON · Swagger UI)
                    │
                    ▼
              apps/web             (nginx: estáticos + proxy /api · React + Recharts)
```

### Decisiones de diseño

- **Idempotencia:** `INSERT … ON CONFLICT (source, external_id) DO UPDATE`. Correr el ETL dos veces no duplica;
  `first_seen_at` se conserva y `last_seen_at` se refresca.
- **Una oferta rota no tumba la ejecución**, y **una fuente caída no tumba a las demás**: cada una se ejecuta aislada
  y su resultado queda en `etl_runs`.
- **Respeto a los límites de las fuentes:** `ETL_INTERVAL_HOURS` no puede ser menor a 6 y una guarda en base de datos
  evita consultar de nuevo si ya hubo un intento reciente (incluso fallido), para que un contenedor reiniciándose en
  bucle no bombardee ninguna API. Un `429` no se reintenta.
- **Extractor de skills sin falsos positivos típicos:** "Go", "R", "React" o "Swift" son palabras comunes del inglés;
  solo cuentan si la oferta ya tiene otras tecnologías claras y no van seguidas de "to market", "beyond", etc.
- **Relevancia (`is_tech`):** una oferta es tecnológica si lo dice su categoría/etiquetas, su título, o menciona al menos
  2 tecnologías. Se guarda todo y se filtra al consultar.
- **Columna `raw` (JSONB):** guarda el original para reprocesar sin volver a llamar a la API.
- **Salarios conservadores:** solo montos anuales; las tarifas por hora quedan en `NULL`.

## Atribución y términos de las fuentes

- **Remotive** ([API pública](https://github.com/remotive-com/remote-jobs-api)): pide enlazar a la oferta original, citar a
  Remotive, no enviar sus ofertas a sitios de terceros y no mostrarlas para captar registros. Llegan con 24 h de retraso.
- **Arbeitnow** ([API](https://www.arbeitnow.com/blog/job-board-api)): su documentación pública no detalla términos;
  conserva siempre el enlace a la oferta original.
- **Hacker News** (vía Algolia): cada oferta enlaza a su comentario original (`jobs.url`).

Cualquier vista pública que muestre ofertas debe incluir ese enlace y la atribución a la fuente.

## Hoja de ruta

- [x] Semana 1: cimientos, Remotive, migraciones, ETL idempotente
- [x] Semana 2: Arbeitnow, Hacker News, extractor de skills, `is_tech`, reprocesado
- [x] Informe de tecnologías por fuente (`report-cli`)
- [ ] Deduplicación entre fuentes (la misma oferta puede aparecer en dos)
- [x] Semana 3: API REST (skills, tendencias, ofertas) con Zod y Swagger
- [x] Semana 4: dashboard React + TypeScript con gráficos
- [x] Semana 5: "Mi match" (`/api/match` + vista)
- [ ] Despliegue online (HTTPS)
- [ ] Redis (caché; poco valor mientras la API ya cachea 60 s)
