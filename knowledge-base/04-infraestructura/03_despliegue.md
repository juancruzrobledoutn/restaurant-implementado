# 03. Despliegue

## Introduccion

Integrador soporta multiples estrategias de despliegue segun el contexto: desarrollo local con Docker, desarrollo hibrido (Docker parcial + servicios manuales), DevContainer para VSCode, y despliegue a produccion con escalado horizontal via Docker Compose overlays y CI/CD con GitHub Actions.

---

## Opcion 1: Docker Compose Completo (Recomendado para Desarrollo)

La forma mas rapida de levantar todo el backend es Docker Compose. Un solo comando inicia base de datos, cache, API REST y Gateway WebSocket.

### Pasos

```bash
# 1. Levantar todos los servicios
cd devOps && docker compose up -d --build

# 2. Verificar que los servicios estan saludables
docker compose ps

# 3. Ver logs en tiempo real
docker compose logs -f backend ws_gateway

# 4. Detener todo
docker compose down
```

### Servicios Levantados

| Servicio | Imagen | Puerto Externo | Descripcion |
|----------|--------|---------------|-------------|
| db | postgres:16 + pgvector | 5432 | Base de datos principal |
| redis | redis:7-alpine | 6380 | Cache, eventos, blacklist |
| backend | Build local | 8000 | API REST (FastAPI) |
| ws_gateway | Build local | 8001 | Gateway WebSocket |
| pgadmin | pgadmin4 | 5050 | Administrador de base de datos (web) |

### Orden de Inicio

Docker Compose respeta dependencias con `depends_on` y health checks:

```
1. db (PostgreSQL)      → espera: pg_isready
2. redis                → espera: redis-cli ping
3. backend              → espera: db + redis healthy
4. ws_gateway           → espera: backend healthy
5. pgadmin              → sin dependencias criticas
```

### Reconstruir Despues de Cambios

```bash
# Solo reconstruir el backend (sin tocar db/redis)
docker compose up -d --build backend

# Reconstruir todo
docker compose up -d --build

# Reconstruir desde cero (elimina volumenes)
docker compose down -v && docker compose up -d --build
```

> **Advertencia**: `docker compose down -v` elimina los volumenes de PostgreSQL. Todos los datos se pierden.

---

## Opcion 2: Docker Parcial + Servicios Manuales

Util cuando se necesita depurar el backend con breakpoints o se quiere hot-reload mas rapido que el que ofrece Docker.

### Pasos

```bash
# 1. Solo base de datos y Redis en Docker
docker compose -f devOps/docker-compose.yml up -d db redis

# 2. Backend manual (terminal 1)
cd backend
pip install -r requirements.txt
python -m uvicorn rest_api.main:app --reload --port 8000

# 3. WebSocket Gateway manual (terminal 2)
# Windows PowerShell:
$env:PYTHONPATH = "$PWD\backend"
python -m uvicorn ws_gateway.main:app --reload --port 8001

# Linux/macOS:
PYTHONPATH=./backend python -m uvicorn ws_gateway.main:app --reload --port 8001
```

### Consideraciones

- El WS Gateway importa modulos de `backend/shared/`, por eso necesita `PYTHONPATH` apuntando al directorio `backend/`.
- En Windows, `uvicorn` puede no estar en el PATH. Siempre usar `python -m uvicorn`.
- El hot-reload de uvicorn en Windows usa `watchfiles`. Si un nuevo archivo de ruta no se detecta, reiniciar manualmente.

---

## Frontends (Siempre Manuales)

Los frontends no se ejecutan en Docker durante desarrollo. Cada uno corre en su propio servidor de Vite.

### Pasos

```bash
# Terminal 3: Dashboard (puerto 5177)
cd Dashboard && npm install && npm run dev

# Terminal 4: pwaMenu (puerto 5176)
cd pwaMenu && npm install && npm run dev

# Terminal 5: pwaWaiter (puerto 5178)
cd pwaWaiter && npm install && npm run dev
```

### Requisitos Previos

1. Node.js 22 LTS instalado.
2. Archivo `.env` creado a partir de `.env.example` en cada directorio.
3. Backend corriendo (Docker o manual) para que las llamadas API funcionen.

### Puertos por Defecto

| Frontend | Puerto | Descripcion |
|----------|--------|-------------|
| pwaMenu | 5176 | Menu publico para clientes |
| Dashboard | 5177 | Panel de administracion |
| pwaWaiter | 5178 | App del mozo |

---

## DevContainer (VSCode)

El proyecto incluye configuracion de DevContainer para desarrollo reproducible en cualquier maquina.

### Como Usarlo

1. Instalar la extension "Remote - Containers" en VSCode.
2. Abrir el proyecto y seleccionar "Reopen in Container".
3. El contenedor se construye automaticamente con todas las dependencias.

### Que Hace Automaticamente

- **docker-compose.dev.yml**: Levanta `db` y `redis` como servicios auxiliares.
- **post-create.sh**: Se ejecuta al crear el contenedor.
  - Instala dependencias de Python (`pip install -r requirements.txt`).
  - Instala dependencias de Node.js (`npm install` en cada frontend).
- **post-start.sh**: Se ejecuta cada vez que el contenedor inicia.
  - Ejecuta migraciones de Alembic (`alembic upgrade head`).

---

## Setup Inicial (Primera Vez)

Independientemente de la estrategia de despliegue elegida, el setup inicial requiere:

### 1. Configurar Variables de Entorno

```bash
# Backend
cp backend/.env.example backend/.env

# Frontends
cp Dashboard/.env.example Dashboard/.env
cp pwaMenu/.env.example pwaMenu/.env
cp pwaWaiter/.env.example pwaWaiter/.env
```

### 2. Levantar Servicios de Infraestructura

```bash
cd devOps && docker compose up -d db redis
```

### 3. Ejecutar Migraciones

```bash
cd backend && alembic upgrade head
```

### 4. Cargar Datos de Prueba (Seed)

```bash
cd backend && python cli.py db-seed
# O cargar modulos especificos:
cd backend && python cli.py db-seed --only=users
```

### 5. Verificar con Usuarios de Prueba

| Usuario | Password | Rol |
|---------|----------|-----|
| admin@demo.com | admin123 | ADMIN |
| waiter@demo.com | waiter123 | WAITER |
| kitchen@demo.com | kitchen123 | KITCHEN |
| ana@demo.com | ana123 | WAITER |
| alberto.cortez@demo.com | waiter123 | WAITER |

---

## Endpoints de Salud (Health Checks)

Cada servicio expone un endpoint de salud para verificar su estado:

| Servicio | Endpoint | Respuesta OK |
|----------|----------|-------------|
| REST API | `GET /api/health` | HTTP 200 |
| WS Gateway | `GET /ws/health` | HTTP 200 |
| PostgreSQL | `pg_isready -U postgres` | Exit code 0 |
| Redis | `redis-cli ping` | `PONG` |

### Verificacion Rapida

```bash
# Backend REST API
curl http://localhost:8000/api/health

# WebSocket Gateway
curl http://localhost:8001/ws/health

# PostgreSQL (desde Docker)
docker exec devops-db-1 pg_isready -U postgres

# Redis (desde Docker)
docker exec devops-redis-1 redis-cli ping
```

---

## Mapa de Puertos Completo

| Servicio | Puerto Desarrollo | Puerto Docker | Notas |
|----------|------------------|---------------|-------|
| REST API | 8000 | 8000 | FastAPI + uvicorn |
| WS Gateway | 8001 | 8001 | WebSocket + uvicorn |
| PostgreSQL | 5432 | 5432 | Acceso directo |
| Redis | 6380 | 6380 (ext) / 6379 (int) | Puerto externo distinto para evitar conflictos |
| pgAdmin | 5050 | 5050 | admin@admin.com / admin |
| Dashboard | 5177 | - | Solo Vite dev server |
| pwaMenu | 5176 | - | Solo Vite dev server |
| pwaWaiter | 5178 | - | Solo Vite dev server |

---

## Produccion

### Despliegue con Docker Compose Overlay

El despliegue a produccion esta configurado mediante un overlay de Docker Compose que extiende la configuracion de desarrollo con replicas, load balancing y alta disponibilidad.

```bash
cd devOps
cp .env.example .env                  # Editar con secrets de produccion
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Arquitectura de Produccion

| Componente | Configuracion | Notas |
|------------|--------------|-------|
| Backend | 2 replicas | Detras de nginx load balancer |
| WS Gateway | 2 replicas | Requiere `ip_hash` sticky sessions en nginx (ConnectionManager in-memory) |
| nginx | Load balancer | Distribuye trafico entre replicas de backend y ws_gateway |
| Redis Sentinel | Alta disponibilidad | Failover automatico de Redis |
| PostgreSQL | Instancia unica (o gestionada: RDS, Cloud SQL) | Imagen optimizada con pgvector |
| Frontends | Build estatico con `npm run build` (Vite) | Servidos desde CDN o nginx como archivos estaticos |

### Requisitos de Produccion

```bash
# .env de produccion (OBLIGATORIO)
JWT_SECRET=<32+ caracteres aleatorios>
TABLE_TOKEN_SECRET=<32+ caracteres aleatorios>
ALLOWED_ORIGINS=https://admin.buensabor.com,https://menu.buensabor.com,https://mozo.buensabor.com
DEBUG=false
ENVIRONMENT=production
COOKIE_SECURE=true
```

### CI/CD con GitHub Actions

El proyecto cuenta con dos workflows de GitHub Actions en `.github/workflows/`:

| Workflow | Archivo | Trigger | Descripcion |
|----------|---------|---------|-------------|
| CI | `ci.yml` | Push/PR a main/develop | 4 jobs paralelos: backend (pytest + PostgreSQL + Redis), Dashboard (lint + type-check + test + build), pwaMenu (lint + type-check + test + build), pwaWaiter (lint + type-check + test + build) |
| Docker Build | `docker-build.yml` | Cambios en backend/ws_gateway/devOps | Valida que las imagenes Docker se construyan correctamente |

### Backups

El directorio `devOps/backup/` contiene scripts de backup y restore:

- **`backup.sh`**: Backup completo de PostgreSQL (dump) + Redis (AOF) empaquetado en `.tar.gz`. Rotacion automatica: 7 copias diarias, 4 semanales.
- **`restore.sh`**: Restore interactivo desde archivo `.tar.gz` con verificacion de health check post-restore.

```bash
cd devOps
./backup/backup.sh                        # Full backup → ./backups/
./backup/restore.sh backups/file.tar.gz   # Restore interactivo
```

### Escalado Horizontal

Documentado en `devOps/SCALING.md`. Puntos clave:

- WebSocket Gateway requiere sticky sessions (`ip_hash` en nginx) porque `ConnectionManager` mantiene conexiones en memoria por instancia.
- El backend REST es stateless y escala horizontalmente sin restricciones.
- Redis Sentinel provee failover automatico para alta disponibilidad.

### Estado de Componentes de Produccion

| Componente | Estado | Descripcion |
|------------|--------|-------------|
| Docker multi-stage build | Configurado | Backend basado en `python:3.12-slim` |
| CI/CD Pipeline | Implementado | GitHub Actions: `ci.yml` + `docker-build.yml` |
| Load Balancer | Configurado | nginx en `docker-compose.prod.yml` |
| Escalado Horizontal | Configurado | 2x backend, 2x ws_gateway via overlay |
| Redis Sentinel | Configurado | En `docker-compose.prod.yml` |
| Backups | Implementado | Scripts en `devOps/backup/` con rotacion |
| TLS/SSL | No configurado | Certificados para HTTPS pendientes (requerido para cookies seguras) |
| Log Aggregation | No implementado | Centralizacion de logs (ELK, CloudWatch, etc.) pendiente |
| Monitoreo APM | Parcial | web-vitals en frontend, falta APM en backend |
| CDN | No configurado | Para servir assets estaticos de los frontends |

---

## Problemas Comunes en Despliegue

### Backend no recarga en Windows

El mecanismo `StatReload` de uvicorn puede fallar en Windows. El proyecto usa `watchfiles` como alternativa, pero archivos nuevos (especialmente rutas) pueden no detectarse. Solucion: reiniciar manualmente el servidor.

### WebSocket se desconecta cada 30 segundos

El token JWT tiene 15 minutos de vida, pero el heartbeat del WebSocket es cada 30 segundos. Si el token expira durante la conexion, el gateway cierra con codigo `4001`. Solucion: los frontends implementan refresh proactivo a los 14 minutos.

### uvicorn no encontrado en Windows

En Windows, `uvicorn` puede no estar en el PATH del sistema. Usar siempre `python -m uvicorn` en lugar de `uvicorn` directamente.

### Error 404 en pwaMenu

Si pwaMenu devuelve 404 en llamadas API, verificar que `VITE_API_URL` incluya el sufijo `/api`: `VITE_API_URL=http://localhost:8000/api`.

### CORS rechaza requests

En desarrollo, el backend usa origenes localhost por defecto. Al agregar nuevos origenes, actualizar:
1. `DEFAULT_CORS_ORIGINS` en `backend/rest_api/main.py`
2. `DEFAULT_CORS_ORIGINS` en `ws_gateway/components/core/constants.py`

### Estado de mesa no se actualiza al escanear QR

1. Verificar que `VITE_BRANCH_SLUG` en `pwaMenu/.env` coincide con el `slug` de la sucursal en la base de datos.
2. Verificar que `branch_slug` se pasa al endpoint de sesion.
3. Verificar que el WS Gateway esta corriendo en el puerto 8001.

### pgAdmin no conecta a PostgreSQL

Dentro de Docker, pgAdmin debe conectar usando el hostname `db` (no `localhost`), puerto `5432`, usuario `postgres`, password `postgres`.
