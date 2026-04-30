# 06. Deploy de Staging — Backend en EasyPanel (Hostinger VPS)

## Contexto

Documento el deploy real del stack backend (PostgreSQL + Redis + REST API + WebSocket Gateway) en una instancia de **EasyPanel** corriendo sobre VPS de Hostinger (KVM4: 4 vCPU, 16 GB RAM). Es un staging interno para que el equipo pruebe features end-to-end. NO es produccion — los frontends viven en Vercel y el backend genera URLs auto-firmadas tipo `*.<id>.easypanel.host` con SSL automatico.

Este archivo captura el procedimiento **correcto** despues de iterar sobre los issues iniciales. Si seguis estos pasos en orden no deberias tropezarte.

---

## Pre-requisitos

| Requisito | Donde |
|-----------|-------|
| VPS con EasyPanel instalado | Hostinger (>= KVM4 recomendado para todo el stack + monitoreo del panel) |
| Repo en GitHub publico | EasyPanel puede clonar privados con OAuth, pero publico simplifica |
| Cuenta `gh` autenticada localmente | Para pushear cambios desde tu maquina |
| Archivo `devOps/docker-compose.staging.yml` en el repo | Compose minimo (4 servicios), explicado abajo |
| Archivo `backend/.dockerignore` | Para no copiar `.env` con secretos al build |

---

## Estructura del compose

`devOps/docker-compose.staging.yml` define 4 servicios:

| Servicio | Imagen | Puerto interno | Notas |
|----------|--------|---------------|-------|
| `db` | `pgvector/pgvector:pg16` | 5432 | NO expone puerto al host (solo red Docker interna) |
| `redis` | `redis:7-alpine` | 6379 | NO expone puerto al host |
| `backend` | Build de `backend/Dockerfile` | 8000 | Expone 8000 para que EasyPanel/Traefik le pueda rutear |
| `ws_gateway` | Build de `ws_gateway/Dockerfile` | 8001 | Expone 8001 |

**Lo que NO incluye** (vs `docker-compose.prod.yml`):

- Replicas (1 instancia de cada servicio, no HA)
- nginx + certbot (EasyPanel termina SSL con Traefik)
- redis-sentinel (sin replicas no tiene sentido)
- Stack de monitoreo (Prometheus, Grafana, Loki, Alertmanager, exporters) — innecesario para staging interno
- pgadmin (no se uso en este caso)

Recursos maximos: ~2.6 GB RAM, 3 vCPU. Entra holgado en KVM4.

---

## Build context y Dockerfile (gotcha)

El `backend/Dockerfile` espera **build context = `backend/`**, no la raiz del repo. Por eso el compose usa:

```yaml
backend:
  build:
    context: ../backend       # desde devOps/ es ../backend
    dockerfile: Dockerfile
```

El `ws_gateway/Dockerfile` SI espera contexto = raiz del repo (porque copia `backend/shared` ademas de `ws_gateway/`):

```yaml
ws_gateway:
  build:
    context: ..               # raiz del repo
    dockerfile: ws_gateway/Dockerfile
```

Estas configuraciones son distintas a proposito. NO las unifiques.

---

## Estrategia de variables de entorno

EasyPanel tiene un panel "Environment" donde el usuario carga env vars. Esas vars terminan en un `docker-compose.override.yml` auto-generado con un bloque `environment:` por servicio. PERO Docker Compose interpola `${VAR}` en **parse time**, ANTES del merge del override — entonces los valores del panel NO estan disponibles para interpolacion en el compose principal.

Implicancia practica: **no usar `${VAR:?error}`** (sintaxis estricta) en el compose. Usar `${VAR:-default}` con placeholders inseguros como default. El override de EasyPanel pisa con valores reales en el container env.

```yaml
# MAL (falla en parse time si VAR no esta en shell env / .env file)
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}

# BIEN (parse time usa default; runtime container env recibe el valor real via override)
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-INSECURE_PLACEHOLDER_OVERRIDE_IN_EASYPANEL}
```

**DATABASE_URL es especial**: como se construye de partes (`${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`), si la interpolacion usa defaults pero el override solo pisa los componentes individuales, el DATABASE_URL queda con defaults. Solucion: tratarlo como una sola env var:

```yaml
- DATABASE_URL=${DATABASE_URL:-postgresql+psycopg://integrador:INSECURE_PLACEHOLDER@db:5432/integrador_staging}
```

Y el usuario configura `DATABASE_URL` directo en el panel de EasyPanel con la password real ya inyectada en la URL.

Para items NO sensibles como `POSTGRES_DB` y `POSTGRES_USER`, lo mas simple es **hardcodearlos** en el compose. Listo, sin interpolacion ni overrides.

---

## Comando de inicio del backend (gotcha 2)

El `backend/Dockerfile` tiene este `CMD`:

```dockerfile
CMD ["sh", "-c", "alembic upgrade head && python -m rest_api.seeds.runner && uvicorn rest_api.main:app --host 0.0.0.0 --port 8000 --reload"]
```

Migraciones + seed + serve, los tres idempotentes. Si el compose **override** del `command:`, lo PISA y se pierden las migraciones y el seed. Por eso el staging compose define un `command` que mantiene la cadena, pero sin `--reload`:

```yaml
command:
  - sh
  - -c
  - "alembic upgrade head && python -m rest_api.seeds.runner && exec python -m uvicorn rest_api.main:app --host 0.0.0.0 --port 8000 --workers 1 --limit-concurrency 50 --timeout-keep-alive 30 --access-log"
```

Notas:

- **Array form en lugar de `>` folded scalar** — evita doble shell wrapping que en algunos casos come los flags `--host`.
- **`exec` antes de `uvicorn`** — reemplaza el proceso `sh` con `uvicorn` para que las senales (SIGTERM) se propaguen bien.
- **`--workers 1`** suficiente para staging (2 si necesitan mas concurrencia).

Sin `exec`, vimos en logs que uvicorn reportaba `Uvicorn running on http://127.0.0.1:8000` (incorrecto) por algun mecanismo de wrapping doble. Con array form + exec quedo en `0.0.0.0:8000`.

---

## Procedimiento de deploy

### 1. Crear proyecto y servicio Compose

1. Login en el panel de EasyPanel.
2. `+ Project` -> nombre por ejemplo `restaurant-staging`.
3. Dentro del proyecto: `+ Service` -> tipo **`Compose`** (NO "App", NO "Database").
4. Nombre del servicio: `backend` (es solo una etiqueta del servicio EasyPanel; el Compose adentro levanta los 4 containers).

### 2. Configurar la fuente

En la seccion **Source** del servicio:

| Campo | Valor |
|-------|-------|
| Type | GitHub |
| Owner/Repo | `<tu-usuario>/<tu-repo>` |
| Branch | `main` |
| Build path | (vacio o `/`) |

### 3. Apuntar al compose file

En la seccion **Compose** (nombre puede variar segun version):

| Campo | Valor |
|-------|-------|
| File path | `devOps/docker-compose.staging.yml` |

### 4. Cargar env vars

Pestana **Environment** (la UI varia por version). Set minimo:

```
# Critical secrets (sin defaults seguros)
POSTGRES_PASSWORD=<openssl rand -base64 24>
JWT_SECRET=<openssl rand -base64 32>
TABLE_TOKEN_SECRET=<openssl rand -base64 32>
DATABASE_URL=postgresql+psycopg://integrador:<TU_POSTGRES_PASSWORD>@db:5432/integrador_staging

# JWT settings (defaults sirven para staging)
JWT_ISSUER=integrador-staging
JWT_AUDIENCE=integrador-users
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=15
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7
JWT_TABLE_TOKEN_EXPIRE_HOURS=3

# Table Token
TABLE_TOKEN_TTL_SECONDS=10800

# CORS — placeholders al principio; se actualiza despues con URLs de Vercel
ALLOWED_ORIGINS=http://localhost:5176,http://localhost:5177,http://localhost:5178
WS_ALLOWED_ORIGINS=http://localhost:5176,http://localhost:5177,http://localhost:5178

# WebSocket tuning
WS_MAX_CONNECTIONS=200
WS_MAX_CONNECTIONS_PER_USER=3
WS_BROADCAST_WORKERS=5
WS_BROADCAST_QUEUE_SIZE=2000
WS_STREAM_CRITICAL=events:critical
WS_STREAM_GROUP=ws_gateway_group
WS_STREAM_DLQ=events:dlq
```

`POSTGRES_DB` y `POSTGRES_USER` ya estan hardcodeados en el compose, no hace falta setearlos en el panel.

**`DATABASE_URL` debe contener el mismo password que `POSTGRES_PASSWORD`** — son la fuente de verdad consistente. Si tu password tiene caracteres especiales (`@`, `:`, `/`, `?`, `#`), tenes que url-encodearlos en `DATABASE_URL`.

### 5. Click en `Deploy`

EasyPanel:
1. Hace `git clone` del repo
2. Buildea las imagenes del backend y ws_gateway (~5-10 min en primer deploy)
3. Pullea las imagenes de pgvector y redis
4. Levanta los 4 containers en orden segun `depends_on` + healthchecks

### 6. Verificar logs

Pestana **Logs** del servicio. Los 4 containers loggean entremezclado. Que tenes que ver:

```
[redis]       Ready to accept connections tcp
[db]          database system is ready to accept connections
[backend]     INFO  [alembic.runtime.migration] Running upgrade ...
[backend]     Seeds runner: tenant created / data seeded
[backend]     Application startup complete
[backend]     Uvicorn running on http://0.0.0.0:8000     <-- 0.0.0.0, NO 127.0.0.1
[ws_gateway]  Application startup complete
[ws_gateway]  Uvicorn running on http://0.0.0.0:8001
```

### 7. Configurar dominios

Pestana **Domains** del servicio. Crear DOS dominios:

**Dominio backend:**

| Campo | Valor |
|-------|-------|
| HTTPS | ON |
| Host | `<proyecto>-backend.<id>.easypanel.host` |
| Source/Ruta | `/` |
| Protocolo destino | HTTP |
| Servicio Compose | `backend` |
| Puerto | `8000` |
| Destination/Ruta | (vacia o `/`) |

**Dominio ws_gateway:**

| Campo | Valor |
|-------|-------|
| HTTPS | ON |
| Host | `<proyecto>-ws.<id>.easypanel.host` |
| Source/Ruta | `/` |
| Protocolo destino | HTTP |
| Servicio Compose | `ws_gateway` |
| Puerto | `8001` |
| Destination/Ruta | (vacia o `/`) |
| WebSocket support | ⚠️ ON (toggle critico — sin esto las conexiones WS fallan) |

**Gotcha**: el `id` del proyecto (algo como `3xzl86`) hay que escribirlo IDENTICO al de tus otras apps en el mismo VPS. La letra `l` minuscula y el `1` (uno) son confundibles. Verificar mirando otro deploy tuyo si tenes uno funcionando.

### 8. Smoke test

Desde el browser:

```
https://<proyecto>-backend.<id>.easypanel.host/api/health
https://<proyecto>-ws.<id>.easypanel.host/health
```

Tienen que devolver `{"status":"ok",...}` o equivalente. Si tiran 404 con texto "Make sure you have the correct URL and that you have configured your domain correctly", el dominio NO esta registrado en Traefik (no se guardo, refrescar UI / recrear).

Si el backend tira "Service is not reachable", el container no esta accesible en el puerto declarado — revisar que uvicorn este en `0.0.0.0:8000` (no `127.0.0.1`).

---

## Actualizar CORS despues del deploy de Vercel

Una vez que los 3 frontends estan en Vercel y conoces sus URLs publicas, volve al panel **Environment** y reemplaza:

```
ALLOWED_ORIGINS=https://<dashboard>.vercel.app,https://<pwamenu>.vercel.app,https://<pwawaiter>.vercel.app
WS_ALLOWED_ORIGINS=https://<dashboard>.vercel.app,https://<pwamenu>.vercel.app,https://<pwawaiter>.vercel.app
```

Click `Deploy` de nuevo (EasyPanel reinicia el container con el env nuevo). Sin esto, el browser bloquea las requests cross-origin.

---

## Troubleshooting rapido

| Sintoma | Causa probable | Fix |
|---------|---------------|-----|
| `error while interpolating ... required variable X is missing` | `${VAR:?error}` en el compose no ve la var | Cambiar a `${VAR:-default}` |
| `Service is not reachable` en URL del backend | uvicorn binding a `127.0.0.1` | Verificar que el `command:` use array form + exec |
| `404 - configured your domain correctly` | Dominio no se guardo en Traefik | Volver a crear el dominio, refrescar UI, esperar 30 seg |
| `connection refused` backend → db | DB todavia no esta healthy | Aumentar `start_period` del healthcheck del backend |
| Migrations fallan en primer deploy | volume `pgdata-staging` corrupto de un intento previo | Borrar el volumen y redeployar (tener cuidado: pierde datos) |
| Build falla en `COPY requirements.txt .` | Build context apuntando a la raiz en lugar de `backend/` | Verificar que el compose tenga `context: ../backend` para el servicio backend |

---

## Referencias

- `devOps/docker-compose.staging.yml` — el archivo
- `devOps/staging.env.example` — template de env vars
- `backend/.dockerignore` — excluye `.env` y otros archivos del build
- `backend/Dockerfile` — define el CMD con migraciones + seed
- `ws_gateway/Dockerfile` — produccion-ready, distinto context
