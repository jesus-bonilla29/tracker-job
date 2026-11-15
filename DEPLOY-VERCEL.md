# Despliegue gratuito: Vercel + Neon + GitHub Actions

```
Navegador ──> Vercel ──estáticos──> dashboard (apps/web/dist)
                 └──/api/*──────> función serverless (api/index.mjs → apps/api)  ──> Neon (Postgres)
GitHub Actions (cron cada 3 h) ──> worker (RUN_ONCE) ─────────────────────────────> Neon (Postgres)
```

## 1. Base de datos (Neon)
1. Crea un proyecto en <https://neon.tech> (plan gratuito).
2. En *Connect* copia **dos** cadenas:
   - **Pooled** (el host contiene `-pooler`): para la API en Vercel.
   - **Direct** (sin `-pooler`): para el worker en GitHub Actions.

Las migraciones las aplica el worker en su primera ejecución, así que haz ese paso (3) antes de abrir el sitio.

## 2. Worker (GitHub Actions)
En GitHub: *Settings → Secrets and variables → Actions → New repository secret*
- `DATABASE_URL` = cadena **Direct** de Neon.

Luego *Actions → ETL (worker) → Run workflow* para la primera carga (migra y descarga datos).
Después corre solo cada 3 h; el worker omite las fuentes consultadas hace menos de 6 h.

## 3. API + dashboard (Vercel)
1. <https://vercel.com/new> → importa el repo. Deja el *Framework Preset* en **Other**; `vercel.json` ya define build y salida.
2. Variables de entorno (Production):
   - `DATABASE_URL` = cadena **Pooled** de Neon.
   - `TRUST_PROXY` = `1`
   - `RATE_LIMIT_PER_MIN` = `120`
3. Deploy. Comprueba `https://TU-PROYECTO.vercel.app/api/health` y `/api/docs`.

## Limitaciones a conocer
- El límite de peticiones es por instancia (memoria): frena abusos simples, no es un límite global.
- Neon gratuito suspende el cómputo tras inactividad: la primera petición puede tardar 1–2 s.
- Los workflows programados se pausan si el repo pasa 60 días sin actividad (GitHub los desactiva): reactívalos en *Actions*.
