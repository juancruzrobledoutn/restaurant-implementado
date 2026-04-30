# 01. Configuracion y Entornos

## Introduccion

La configuracion del sistema Integrador se gestiona mediante archivos `.env` independientes para cada componente. Este enfoque permite que cada servicio (backend, Dashboard, pwaMenu, pwaWaiter) defina sus propias variables de entorno sin interferir con los demas.

Cada componente incluye un archivo `.env.example` como plantilla. El primer paso en cualquier entorno nuevo es copiar ese archivo a `.env` y ajustar los valores segun corresponda.

---

## Backend (.env)

El backend (FastAPI) concentra la mayor cantidad de configuracion ya que gestiona base de datos, cache, autenticacion, WebSocket y servicios externos.

### Variables Principales

```bash
# ── Entorno ──────────────────────────────────────────────
ENVIRONMENT=development|production
DEBUG=true|false
```

- `ENVIRONMENT` determina el comportamiento de validaciones de seguridad. En `production`, el sistema exige secretos fuertes, CORS restrictivo y cookies seguras.
- `DEBUG` controla el nivel de logging y la exposicion de trazas de error en las respuestas HTTP.

### Base de Datos

```bash
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/menu_ops
```

- Driver: `psycopg` (psycopg3), el driver moderno de PostgreSQL para Python.
- En Docker Compose, el host cambia de `localhost` a `db` (nombre del servicio).
- La base de datos incluye la extension `pgvector` para funcionalidades de IA (embeddings).

### Redis

```bash
REDIS_URL=redis://localhost:6380
```

- Puerto externo: `6380` (mapeado desde el `6379` interno de Docker).
- Se usa para: cache de sesiones, publicacion de eventos WebSocket, blacklist de tokens JWT, rate limiting y circuit breaker.
- Politica de eviccion: `allkeys-lru` con limite de 256MB.

### Autenticacion JWT

```bash
JWT_SECRET=<32+ caracteres aleatorios>
JWT_ISSUER=menu-ops
JWT_AUDIENCE=menu-ops-users
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=15
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7
```

- **JWT_SECRET**: CRITICO. Debe tener al menos 32 caracteres aleatorios. El valor por defecto de desarrollo NO es seguro para produccion.
- Access token: 15 minutos de vida. Los frontends (Dashboard, pwaWaiter) refrescan proactivamente a los 14 minutos para evitar interrupciones.
- Refresh token: 7 dias. Se almacena en cookies HttpOnly (no accesible por JavaScript).

### Token de Mesa (HMAC)

```bash
TABLE_TOKEN_SECRET=<32+ caracteres aleatorios>
JWT_TABLE_TOKEN_EXPIRE_HOURS=3
```

- Mecanismo de autenticacion para clientes (comensales) que escanean el QR de la mesa.
- No requiere login: el token se genera al activar la sesion de mesa.
- Vida util de 3 horas, suficiente para una comida completa.

### Rate Limiting

```bash
LOGIN_RATE_LIMIT=5
LOGIN_RATE_WINDOW=60
```

- Limita intentos de login a 5 por ventana de 60 segundos.
- Los endpoints de billing tienen limites adicionales (5-20 por minuto segun el endpoint).
- Implementado con `slowapi` respaldado por Redis.

### WebSocket Gateway

```bash
WS_MAX_CONNECTIONS_PER_USER=3        # desarrollo (5 en Docker Compose)
WS_HEARTBEAT_TIMEOUT=60
WS_MAX_MESSAGE_SIZE=65536
```

- `WS_MAX_CONNECTIONS_PER_USER`: Limite de conexiones simultaneas por usuario. Permite multiples pestanas.
- `WS_HEARTBEAT_TIMEOUT`: Si no se recibe ping en 60 segundos, la conexion se cierra.
- `WS_MAX_MESSAGE_SIZE`: 64KB maximo por mensaje WebSocket.

### Puertos

```bash
REST_API_PORT=8000
WS_GATEWAY_PORT=8001
```

- La API REST y el Gateway WebSocket corren en puertos separados porque son servicios independientes.

### IA (Opcional)

```bash
OLLAMA_URL=http://localhost:11434
EMBED_MODEL=nomic-embed-text
CHAT_MODEL=qwen2.5:7b
```

- Integracion con Ollama para funcionalidades de IA local (embeddings, chat).
- Completamente opcional. El sistema funciona sin estas variables.

### Pagos (Opcional)

```bash
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_WEBHOOK_SECRET=
MERCADOPAGO_NOTIFICATION_URL=
```

- Integracion con Mercado Pago para pagos online desde pwaMenu.
- Si no se configuran, los pagos online quedan deshabilitados. Los pagos manuales (efectivo, tarjeta, transferencia) siguen funcionando.

### CORS

```bash
ALLOWED_ORIGINS=<origenes separados por coma>
```

- CRITICO en produccion. Define que dominios pueden hacer requests al backend.
- En desarrollo, se usan origenes localhost por defecto si no se configura.
- Ejemplo produccion: `ALLOWED_ORIGINS=https://admin.buensabor.com,https://menu.buensabor.com`

---

## Dashboard (.env)

```bash
VITE_API_URL=http://localhost:8000     # SIN sufijo /api
VITE_API_TIMEOUT=30000
VITE_ENVIRONMENT=development
VITE_DEBUG_MODE=true
VITE_DEFAULT_LOCALE=es
```

### Nota Importante sobre VITE_API_URL

El Dashboard usa `VITE_API_URL` **SIN** el sufijo `/api`. Esto es una inconsistencia conocida respecto a pwaMenu y pwaWaiter que si lo incluyen. La razon historica es que el Dashboard fue el primer frontend desarrollado y su capa de API agrega el prefijo internamente.

- `VITE_API_TIMEOUT`: Timeout de requests HTTP en milisegundos (30 segundos por defecto).
- `VITE_DEBUG_MODE`: Activa logging detallado en consola del navegador.
- `VITE_DEFAULT_LOCALE`: Idioma por defecto (el Dashboard solo soporta espanol).

---

## pwaMenu (.env)

```bash
VITE_API_URL=http://localhost:8000/api  # CON sufijo /api
VITE_WS_URL=ws://localhost:8001
VITE_BRANCH_SLUG=centro                # Debe coincidir con el slug de la sucursal en la DB
VITE_RESTAURANT_ID=default
VITE_MP_PUBLIC_KEY=TEST-xxx            # Mercado Pago (public key)
VITE_SESSION_EXPIRY_HOURS=8
```

- `VITE_BRANCH_SLUG`: Identifica la sucursal. Debe coincidir exactamente con el campo `slug` de la tabla `branch` en la base de datos. Si no coincide, el menu no carga.
- `VITE_WS_URL`: URL del WebSocket Gateway para sincronizacion en tiempo real del carrito compartido.
- `VITE_MP_PUBLIC_KEY`: Clave publica de Mercado Pago para el SDK de frontend. Usar claves `TEST-` en desarrollo.
- `VITE_SESSION_EXPIRY_HOURS`: Tiempo de vida del cache local (localStorage). Datos de menu y sesion se invalidan despues de 8 horas.

---

## pwaWaiter (.env)

```bash
VITE_API_URL=http://localhost:8000/api  # CON sufijo /api
VITE_WS_URL=ws://localhost:8001
VITE_VAPID_PUBLIC_KEY=                 # Push notifications (opcional)
```

- Configuracion mas simple de los tres frontends.
- `VITE_VAPID_PUBLIC_KEY`: Para notificaciones push nativas. Opcional; si no se configura, las notificaciones se manejan solo via WebSocket.

---

## Docker Compose (devOps/docker-compose.yml)

El archivo de Docker Compose define todos los servicios con sus variables de entorno internas.

### Variables Internas

| Servicio | Variable | Valor en Docker |
|----------|----------|-----------------|
| PostgreSQL | Usuario/Password | `postgres:postgres` |
| PostgreSQL | Base de datos | `menu_ops` |
| PostgreSQL | Host interno | `db:5432` |
| Redis | Host interno | `redis:6379` |
| Redis | Puerto externo | `6380` |
| Backend | DATABASE_URL | `postgresql+psycopg://postgres:postgres@db:5432/menu_ops` |
| Backend | REDIS_URL | `redis://redis:6379` |
| Backend | JWT_SECRET | `dev-secret-change-me-in-production` |
| WS Gateway | Mismas que backend | Compartidas via ancla YAML |

### Health Checks

Todos los servicios de Docker Compose incluyen health checks:

- **Intervalo**: 30 segundos entre verificaciones.
- **Timeout**: 10 segundos maximo por verificacion.
- **Reintentos**: 3 intentos antes de marcar como unhealthy.
- **PostgreSQL**: `pg_isready -U postgres`
- **Redis**: `redis-cli ping`
- **Backend/WS Gateway**: HTTP GET a su endpoint `/health`

### Dependencias entre Servicios

```
db (PostgreSQL) ──┐
                  ├──► backend ──► ws_gateway
redis ────────────┘
```

El backend espera a que `db` y `redis` esten healthy antes de iniciar. El WS Gateway espera al backend.

---

## Validaciones de Seguridad en Produccion

El archivo `settings.py` del backend ejecuta validaciones automaticas cuando `ENVIRONMENT=production`:

| Validacion | Requisito | Consecuencia si falla |
|------------|-----------|----------------------|
| JWT_SECRET | >= 32 caracteres, no puede ser el valor por defecto | Error al iniciar el servidor |
| TABLE_TOKEN_SECRET | >= 32 caracteres | Error al iniciar el servidor |
| DEBUG | Debe ser `false` | Error al iniciar el servidor |
| ALLOWED_ORIGINS | Debe estar configurado (no usa localhost) | CORS rechaza todos los origenes |
| COOKIE_SECURE | Debe ser `true` | Cookies no se envian sin HTTPS |

### Cabeceras de Seguridad en Produccion

- **HSTS**: `Strict-Transport-Security` (solo produccion, fuerza HTTPS).
- **CSP**: `Content-Security-Policy` (restringe fuentes de scripts, estilos, imagenes).
- **X-Frame-Options**: `DENY` (previene clickjacking).
- **X-Content-Type-Options**: `nosniff` (previene MIME sniffing).

---

## Resumen de Diferencias por Entorno

| Aspecto | Desarrollo | Docker Compose | Produccion |
|---------|-----------|----------------|------------|
| JWT_SECRET | Cualquier valor | `dev-secret-change-me` | 32+ caracteres aleatorios |
| DEBUG | `true` | `true` | `false` |
| CORS | Localhost por defecto | Localhost por defecto | ALLOWED_ORIGINS obligatorio |
| Redis puerto | 6380 | 6380 (ext) / 6379 (int) | Segun infraestructura |
| Cookies | No seguras | No seguras | COOKIE_SECURE=true |
| Base de datos | localhost:5432 | db:5432 | Segun infraestructura |
| Logs | Verbose | Verbose | Solo errores y warnings |
