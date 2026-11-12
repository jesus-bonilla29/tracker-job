#!/usr/bin/env bash
# Copia de seguridad de PostgreSQL (comprimida). Úsalo desde la carpeta del proyecto en el servidor:
#   ./scripts/backup.sh            -> backups/tjt-AAAAMMDD-HHMM.sql.gz  (conserva las últimas 14)
# Restaurar:  gunzip -c backups/ARCHIVO.sql.gz | docker compose exec -T db psql -U tjt -d tjt
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
out="backups/tjt-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > "$out"
ls -1t backups/tjt-*.sql.gz | tail -n +15 | xargs -r rm --
echo "OK: $out"
