# Despliegue en un VPS (Docker + Caddy + HTTPS)

Resultado: `https://tu-nombre.duckdns.org` sirviendo el dashboard y la API, con certificado Let's Encrypt renovado solo.

```
Internet ──443──> Caddy ──/api/*──> api:3000 ──> db
                    └────resto────> web:8080 (nginx, estáticos)      worker ──> db (ETL cada 6 h)
```

Solo Caddy escucha en internet (80 y 443). PostgreSQL, la API y nginx están ligados a `127.0.0.1` del servidor.

## 1. Servidor

Cualquier VPS con Ubuntu 24.04 LTS y **1 GB de RAM como mínimo** (2 GB es más cómodo para construir las imágenes). Opciones habituales:
Hetzner, DigitalOcean, o el nivel gratuito de Oracle Cloud. Al crearlo, añade tu clave SSH y anota la **IP pública**.

```bash
ssh root@IP_DEL_SERVIDOR
adduser deploy && usermod -aG sudo deploy          # usuario normal para el día a día
rsync -a --chown=deploy:deploy ~/.ssh /home/deploy/ # reutiliza tu clave SSH
```

Cortafuegos y Docker:

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

> Docker publica puertos saltándose `ufw`. Por eso el compose liga db/api/web a `127.0.0.1`: `ufw` no es lo que te protege aquí.

## 2. Dominio gratis (DuckDNS)

1. Entra en <https://www.duckdns.org>, crea un subdominio (por ejemplo `mi-tracker`) y pon la **IP del servidor**.
2. Comprueba que resuelve: `dig +short mi-tracker.duckdns.org` debe devolver esa IP. Caddy no podrá pedir el certificado hasta que lo haga.

## 3. Subir el proyecto

Desde tu equipo (sin `node_modules` ni `.env`):

```bash
scp tech-job-tracker-v2.zip deploy@IP_DEL_SERVIDOR:~
ssh deploy@IP_DEL_SERVIDOR
sudo apt-get install -y unzip && unzip tech-job-tracker-v2.zip && cd tech-job-tracker-v2
```

(Con Git es más cómodo: `git clone` y `git pull` en cada actualización.)

## 4. Configuración

```bash
cp .env.example .env
nano .env
```

Valores a cambiar:

```ini
POSTGRES_PASSWORD=<contraseña larga y aleatoria: openssl rand -base64 24>
DOMAIN=mi-tracker.duckdns.org
ACME_EMAIL=tu@correo.com
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
HN_THREADS=6          # opcional: carga meses anteriores de Hacker News para ver tendencias
```

Deja `RATE_LIMIT_PER_MIN=120`. `CORS_ORIGIN` no hace falta (dashboard y API comparten origen). `chmod 600 .env`.

## 5. Arrancar

```bash
docker compose up -d --build
docker compose ps                 # db, api, web y caddy deben salir "healthy"/"running"
docker compose logs -f worker     # primera carga de datos
```

Pruebas:

```bash
curl -I https://mi-tracker.duckdns.org                 # 200 y strict-transport-security
curl -s https://mi-tracker.duckdns.org/api/health
curl -sI http://mi-tracker.duckdns.org | head -1       # 308 -> https
```

Documentación interactiva: `https://mi-tracker.duckdns.org/api/docs`.

## 6. Mantenimiento

| Tarea | Comando |
|---|---|
| Actualizar | subir el código nuevo y `docker compose up -d --build` |
| Ver logs | `docker compose logs -f api` (o `worker`, `caddy`) |
| Copia de seguridad | `./scripts/backup.sh` (guarda las últimas 14 en `backups/`) |
| Copia diaria | `crontab -e` → `30 3 * * * cd ~/tech-job-tracker-v2 && ./scripts/backup.sh >> backups/cron.log 2>&1` |
| Restaurar | `gunzip -c backups/ARCHIVO.sql.gz \| docker compose exec -T db psql -U tjt -d tjt` |
| Parar todo | `docker compose down` (los datos viven en el volumen `pgdata`; `down -v` **los borra**) |

Descarga también las copias a tu equipo de vez en cuando (`scp`): una copia en el mismo disco no te salva si el servidor se pierde.

## 7. Problemas frecuentes

- **Caddy no obtiene el certificado:** `docker compose logs caddy`. Casi siempre es que el DNS aún no apunta a la IP o que el puerto 80/443 está bloqueado en el panel del proveedor (además de `ufw`).
- **Let's Encrypt tiene límites de intentos:** si fallas muchas veces espera; no repitas `up` en bucle.
- **Error 429 de la API:** el límite cuenta la IP real del visitante porque Caddy sobrescribe `X-Forwarded-For`. Si ves a todos en una sola IP, comprueba que `TRUST_PROXY: 1` sigue en el servicio `api`.
- **Sin datos al principio:** el worker tarda unos minutos en la primera carga; Remotive limita las peticiones, así que no fuerces ejecuciones repetidas (`FORCE_RUN`).
- **Sin memoria al construir:** añade swap (`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`).

## 8. Seguridad mínima

- Entra solo con clave SSH: en `/etc/ssh/sshd_config`, `PasswordAuthentication no` y `PermitRootLogin no`, y `sudo systemctl restart ssh`.
- Activa las actualizaciones automáticas: `sudo apt-get install -y unattended-upgrades`.
- No expongas el puerto 5432 ni el 3000: el compose ya no lo hace.
- Las ofertas enlazan a su fuente y se cita su atribución (ver README); mantenlo si cambias la interfaz.
