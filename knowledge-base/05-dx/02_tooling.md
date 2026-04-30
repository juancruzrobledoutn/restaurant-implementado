> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

# Inventario de Herramientas

Inventario completo de todas las herramientas de desarrollo disponibles en el proyecto.

---

## Herramientas de infraestructura

| Herramienta | Ubicacion | Comando | Proposito | Estado |
|-------------|-----------|---------|-----------|--------|
| Docker Compose | `devOps/docker-compose.yml` | `cd devOps && docker compose up -d` | Levantar todos los servicios | FUNCIONAL |
| Docker Compose Prod | `devOps/docker-compose.prod.yml` | `docker compose -f ... -f docker-compose.prod.yml up -d` | Deploy produccion con scaling | FUNCIONAL |
| pgAdmin | `devOps/docker-compose.yml` | http://localhost:5050 | UI para explorar PostgreSQL | FUNCIONAL |
| Backup | `devOps/backup/backup.sh` | `cd devOps && ./backup/backup.sh` | Backup de PostgreSQL + Redis | FUNCIONAL |
| Restore | `devOps/backup/restore.sh` | `./backup/restore.sh file.tar.gz` | Restaurar desde archivo de backup | FUNCIONAL |
| Reset Tables | `devOps/reset_tables.sql` | `psql -f reset_tables.sql` | Limpiar datos transaccionales sin tocar catalogs | FUNCIONAL |

---

## Backend CLI (`backend/cli.py`)

Herramienta centralizada para operaciones de base de datos, cache, monitoreo y diagnostico.

### Comandos de base de datos

| Comando | Descripcion | Ejemplo |
|---------|-------------|---------|
| `db-seed` | Seed completo de la BD con datos de prueba | `python cli.py db-seed` |
| `db-seed --only=users` | Seed parcial (un modulo especifico) | `python cli.py db-seed --only=menu` |
| `db-migrate` | Correr migraciones Alembic pendientes | `python cli.py db-migrate` |

**Modulos de seed disponibles** (`backend/rest_api/seeds/`):
- `tenants` — Tenant y branches base
- `users` — Usuarios de prueba con roles
- `allergens` — Alergenos de referencia
- `menu` — Categorias, subcategorias, productos
- `tables` — Sectores y mesas

### Comandos de cache (Redis)

| Comando | Descripcion | Ejemplo |
|---------|-------------|---------|
| `cache-clear` | Limpiar Redis por patron | `python cli.py cache-clear --pattern="menu:*"` |
| `cache-warm` | Pre-calentar caches frecuentes | `python cli.py cache-warm` |
| `cache-stats` | Estadisticas de uso de Redis | `python cli.py cache-stats` |

### Comandos de Dead Letter Queue

| Comando | Descripcion | Ejemplo |
|---------|-------------|---------|
| `dlq-stats` | Estadisticas de mensajes fallidos | `python cli.py dlq-stats` |
| `dlq-process` | Procesar/reintentar mensajes del DLQ | `python cli.py dlq-process` |

### Comandos de diagnostico

| Comando | Descripcion | Ejemplo |
|---------|-------------|---------|
| `ws-test` | Test de conectividad WebSocket | `python cli.py ws-test` |
| `health` | Verificar salud de todos los servicios | `python cli.py health` |
| `version` | Mostrar versiones de componentes | `python cli.py version` |

---

## Herramientas de migracion

| Herramienta | Ubicacion | Comando | Proposito |
|-------------|-----------|---------|-----------|
| Alembic | `backend/alembic/` | `cd backend && alembic upgrade head` | Migraciones de esquema de BD |
| Alembic revision | `backend/alembic/` | `alembic revision --autogenerate -m "desc"` | Generar nueva migracion |
| Alembic history | `backend/alembic/` | `alembic history` | Ver historial de migraciones |
| Alembic stamp | `backend/alembic/` | `alembic stamp head` | Marcar BD como actualizada sin correr migraciones |

> **Nota:** No existe migracion "initial schema". El schema base se crea con `create_all()`. Las migraciones 001-004 son incrementales.

---

## Herramientas de testing

| Frontend | Comando (watch) | Comando (single run) | Comando (coverage) |
|----------|-----------------|---------------------|-------------------|
| Dashboard | `npm test` | `npm test -- --run` | `npm run test:coverage` |
| pwaMenu | `npm test` | `npm run test:run` | `npm run test:coverage` |
| pwaWaiter | `npm test` | `npm run test:run` | `npm run test:coverage` |

| Backend | Comando | Descripcion |
|---------|---------|-------------|
| Test unico | `python -m pytest tests/test_auth.py -v` | Un archivo especifico |
| Todos | `python -m pytest tests/ -v` | Toda la suite |
| Con coverage | `python -m pytest tests/ --cov=rest_api` | Con reporte de cobertura |

---

## Herramientas de calidad de codigo

| Herramienta | Comando | Aplica a |
|-------------|---------|----------|
| TypeScript check | `npm run type-check` o `npx tsc --noEmit` | Cualquier frontend |
| ESLint | `npm run lint` | Cualquier frontend |
| Prettier | Configurado via ESLint | Cualquier frontend |

---

## CI/CD

| Workflow | Archivo | Trigger | Que hace |
|----------|---------|---------|----------|
| CI Pipeline | `.github/workflows/ci.yml` | Push/PR a main/develop | Lint + test + build automatico |
| Docker Build | `.github/workflows/docker-build.yml` | Push a main (paths backend/devOps) | Validar que Docker builds compilan |

---

## Herramientas en estado scaffold

Estas herramientas estan creadas pero no completamente integradas:

| Herramienta | Ubicacion | Proposito | Estado |
|-------------|-----------|-----------|--------|
| OpenAPI Codegen | `scripts/generate-types.sh` | Generar tipos TypeScript desde OpenAPI spec | SCAFFOLD — script existe pero no integrado en workflow |
| E2E Tests | `e2e/` | Tests end-to-end con Playwright | SCAFFOLD — 3 specs basicos |
| Shared WS Client | `shared/websocket-client.ts` | Cliente WebSocket reutilizable | SCAFFOLD — creado, no adoptado |
