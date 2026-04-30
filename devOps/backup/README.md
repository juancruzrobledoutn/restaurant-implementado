# Backup y Recuperacion de Desastres - Integrador

Sistema de backup automatizado para PostgreSQL 16 (con pgvector) y Redis 7, ejecutado a traves de Docker Compose.

---

## Requisitos Previos

- Docker y Docker Compose instalados
- Los contenedores `integrador_db` y `integrador_redis` deben estar corriendo
- Ejecutar todos los comandos desde el directorio `devOps/`
- Los scripts requieren permisos de ejecucion:

```bash
chmod +x backup/backup.sh backup/restore.sh
```

---

## Backup Manual

### Ejecucion basica

```bash
cd devOps
./backup/backup.sh
```

Esto genera un archivo `.tar.gz` en `devOps/backups/` con nombre:
- **Diario:** `integrador_backup_20260404_030000.tar.gz`
- **Semanal:** `integrador_weekly_20260330_020000.tar.gz` (domingos o forzado)

### Forzar backup semanal

```bash
BACKUP_TYPE=weekly ./backup/backup.sh
```

### Personalizar directorio de destino

```bash
BACKUP_DIR=/mnt/external/backups ./backup/backup.sh
```

### Variables de configuracion

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `BACKUP_DIR` | `./backups` | Directorio donde se guardan los backups |
| `RETENTION_DAILY` | `7` | Cantidad de backups diarios a conservar |
| `RETENTION_WEEKLY` | `4` | Cantidad de backups semanales a conservar |
| `BACKUP_TYPE` | `daily` | Tipo de backup (`daily` o `weekly`) |
| `POSTGRES_DB` | `menu_ops` | Nombre de la base de datos |
| `POSTGRES_USER` | `postgres` | Usuario de PostgreSQL |
| `DB_CONTAINER` | `integrador_db` | Nombre del contenedor de PostgreSQL |
| `REDIS_CONTAINER` | `integrador_redis` | Nombre del contenedor de Redis |

---

## Backup Automatizado (Cron)

### Configuracion

1. Editar el archivo de ejemplo:

```bash
cp backup/backup-cron.example /tmp/integrador-cron
# Editar /tmp/integrador-cron y reemplazar /path/to/devOps con la ruta real
```

2. Instalar en crontab:

```bash
crontab /tmp/integrador-cron
```

3. Verificar:

```bash
crontab -l
```

### Programacion por defecto

| Frecuencia | Horario | Retencion |
|------------|---------|-----------|
| Diario | 3:00 AM | Ultimos 7 dias |
| Semanal | Domingos 2:00 AM | Ultimas 4 semanas |

### Logs

Los logs del cron se escriben en `/var/log/integrador-backup.log`. El log del backup en si queda en `backups/backup.log`.

---

## Restauracion

### Sintaxis

```bash
cd devOps
./backup/restore.sh <archivo-backup.tar.gz> [OPCIONES]
```

### Opciones

| Opcion | Descripcion |
|--------|-------------|
| `--skip-confirmation` | Omite la confirmacion interactiva |
| `--postgres-only` | Restaura solo PostgreSQL |
| `--redis-only` | Restaura solo Redis |

### Ejemplos

```bash
# Restauracion completa
./backup/restore.sh ./backups/integrador_backup_20260404_030000.tar.gz

# Solo PostgreSQL (sin tocar Redis)
./backup/restore.sh ./backups/integrador_backup_20260404_030000.tar.gz --postgres-only

# Sin confirmacion (scripts automatizados)
SKIP_CONFIRMATION=true ./backup/restore.sh ./backups/integrador_weekly_20260330_020000.tar.gz
```

### Que hace el restore

1. Valida que el archivo `.tar.gz` sea correcto
2. Extrae y verifica el contenido
3. **Pide confirmacion** (debe escribirse `RESTORE`)
4. Detiene `backend` y `ws_gateway`
5. Restaura PostgreSQL (drop + create + import)
6. Restaura datos de Redis
7. Reinicia todos los servicios
8. Verifica health checks de DB, Redis y Backend

---

## Formato del Archivo de Backup

```
integrador_backup_20260404_030000.tar.gz
  ├── metadata.txt              # Informacion del backup (fecha, tipo, version)
  ├── postgres/
  │   └── menu_ops.sql          # Dump completo de PostgreSQL (--clean --if-exists)
  └── redis/
      ├── appendonly.aof         # Archivo AOF de Redis
      └── dump.rdb              # Snapshot RDB de Redis (si existe)
```

### Metadata

El archivo `metadata.txt` contiene:
- Nombre y tipo del backup
- Timestamp ISO 8601
- Base de datos y contenedores involucrados
- Version de Docker Compose utilizada

---

## Politica de Retencion

| Tipo | Cantidad | Eliminacion automatica |
|------|----------|----------------------|
| Diario | 7 ultimos | Si, en cada ejecucion |
| Semanal | 4 ultimos | Si, en cada ejecucion |

La rotacion se ejecuta al final de cada backup exitoso. Los backups mas antiguos que excedan el limite se eliminan automaticamente.

Para modificar la retencion:

```bash
RETENTION_DAILY=14 RETENTION_WEEKLY=8 ./backup/backup.sh
```

---

## Procedimiento de Recuperacion de Desastres

### Escenario: Perdida total del servidor

1. **Provision del servidor nuevo** con Docker y Docker Compose instalados.

2. **Clonar el repositorio** del proyecto:
   ```bash
   git clone <repo-url> integrador
   cd integrador/devOps
   ```

3. **Copiar el archivo `.env`** desde un respaldo seguro o recrearlo basandose en `.env.example`.

4. **Levantar la infraestructura base** (sin datos):
   ```bash
   docker compose up -d db redis
   # Esperar a que los contenedores esten healthy
   docker compose ps
   ```

5. **Copiar el backup** mas reciente al servidor:
   ```bash
   scp user@backup-server:/backups/integrador/integrador_weekly_LATEST.tar.gz ./backups/
   ```

6. **Restaurar**:
   ```bash
   chmod +x backup/backup.sh backup/restore.sh
   ./backup/restore.sh ./backups/integrador_weekly_LATEST.tar.gz
   ```

7. **Verificar** (ver seccion siguiente).

### Escenario: Corrupcion de base de datos

1. Detener servicios:
   ```bash
   docker compose stop backend ws_gateway
   ```

2. Restaurar solo PostgreSQL:
   ```bash
   ./backup/restore.sh ./backups/integrador_backup_LATEST.tar.gz --postgres-only
   ```

### Escenario: Perdida de datos de Redis

Redis se usa principalmente para cache y sesiones WebSocket. En la mayoria de los casos, reiniciar Redis es suficiente:

```bash
docker compose restart redis
```

Si se necesita restaurar datos persistentes (Outbox events, sesiones):

```bash
./backup/restore.sh ./backups/integrador_backup_LATEST.tar.gz --redis-only
```

---

## Verificacion Post-Restauracion

### Checks automaticos (incluidos en restore.sh)

- PostgreSQL `pg_isready` responde OK
- Redis `PING` responde `PONG`
- API health endpoint responde HTTP 200
- Conteo de tablas en el schema `public`
- Conteo de keys en Redis (`DBSIZE`)

### Checks manuales recomendados

```bash
# 1. Health check detallado del API
curl http://localhost:8000/api/health/detailed | python -m json.tool

# 2. Verificar que WebSocket Gateway responde
curl http://localhost:8001/ws/health

# 3. Verificar estado de los contenedores
docker compose ps

# 4. Probar login con usuario de prueba
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"admin123"}'

# 5. Verificar conteo de tablas
docker compose exec db psql -U postgres -d menu_ops -c \
  "SELECT count(*) as tablas FROM information_schema.tables WHERE table_schema = 'public';"

# 6. Verificar datos criticos (ejemplo: tenants)
docker compose exec db psql -U postgres -d menu_ops -c \
  "SELECT id, name FROM tenant LIMIT 5;"

# 7. Abrir el Dashboard y verificar visualmente
# http://localhost:5177 → admin@demo.com / admin123
```

---

## Limitaciones Conocidas

| Limitacion | Detalle | Workaround |
|------------|---------|------------|
| **Backup en caliente** | El dump de PostgreSQL es consistente (pg_dump), pero puede haber transacciones en curso al momento del backup | Programar backups en horarios de baja actividad (3 AM) |
| **Redis AOF** | Si Redis esta escribiendo al momento de copiar, el AOF puede estar incompleto | El script ejecuta `BGSAVE` antes de copiar; el RDB snapshot es siempre consistente |
| **Sin backup incremental** | Cada backup es completo (full dump) | Para bases grandes, considerar `pg_basebackup` o WAL archiving |
| **Sin cifrado** | Los archivos de backup no estan cifrados | Cifrar manualmente con `gpg -c archivo.tar.gz` antes de transferir |
| **Sin offsite automatico** | Los backups quedan en el mismo servidor por defecto | Configurar sync a S3/GCS/rsync (ver `backup-cron.example`) |
| **Tamano de la base** | Para bases mayores a 10 GB, el dump puede ser lento | Considerar `pg_dump --format=custom --jobs=4` para paralelismo |
| **Windows** | Los scripts estan disenados para Linux/macOS con bash | En Windows, usar WSL o Git Bash |
| **Downtime en restore** | La restauracion detiene backend y ws_gateway | Planificar ventana de mantenimiento; usuarios activos perderan conexion |

---

## Estructura de Archivos

```
devOps/backup/
  ├── backup.sh              # Script de backup (chmod +x)
  ├── restore.sh             # Script de restauracion (chmod +x)
  ├── backup-cron.example    # Ejemplo de configuracion crontab
  └── README.md              # Este archivo
devOps/backups/              # Directorio de backups (creado automaticamente)
  ├── backup.log             # Log de operaciones
  ├── integrador_backup_*.tar.gz   # Backups diarios
  └── integrador_weekly_*.tar.gz   # Backups semanales
```
