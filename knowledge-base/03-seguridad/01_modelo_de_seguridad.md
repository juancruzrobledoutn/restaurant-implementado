# 01. Modelo de Seguridad

> Documentacion completa del modelo de seguridad del proyecto Integrador / Buen Sabor.
> Cubre autenticacion, autorizacion, rate limiting, validacion de input, headers de seguridad,
> proteccion contra ataques comunes y gestion de secrets.
>
> Ultima actualizacion: 2026-04-04

---

## Indice

1. [Autenticacion](#1-autenticacion)
2. [Autorizacion (RBAC)](#2-autorizacion-rbac)
3. [Rate Limiting](#3-rate-limiting)
4. [Validacion de Input](#4-validacion-de-input)
5. [Headers de Seguridad](#5-headers-de-seguridad)
6. [Proteccion SSRF / XSS / CSRF](#6-proteccion-ssrf--xss--csrf)
7. [Endpoints Publicos](#7-endpoints-publicos)
8. [Gestion de Secrets](#8-gestion-de-secrets)
9. [Resumen de Archivos de Seguridad](#9-resumen-de-archivos-de-seguridad)

---

## 1. Autenticacion

### JWT para Staff (Dashboard + pwaWaiter)

| Parametro | Valor |
|-----------|-------|
| Algoritmo | HS256 |
| Access Token TTL | 15 minutos |
| Refresh Token TTL | 7 dias |
| Almacenamiento access token | `Authorization: Bearer {token}` header |
| Almacenamiento refresh token | HttpOnly cookie, `SameSite=lax`, `Secure` en produccion |
| Refresh proactivo | Cada 14 minutos con jitter +/-2 min |

**Archivos clave:**
- `backend/shared/security/auth.py` -- `verify_jwt()`, `current_user_context()`, emision de tokens
- `Dashboard/src/services/api.ts` -- logica de refresh, mutex, retry en 401
- `pwaWaiter/src/services/api.ts` -- misma logica de refresh

**Flujo de refresh:**
1. El frontend programa un refresh proactivo a los 14 min (con jitter para evitar thundering herd)
2. Si el access token expira antes del refresh (ej: pestana en background), el interceptor 401 lo maneja
3. Mutex garantiza que solo un refresh se ejecute simultaneamente (multiples requests 401 no generan multiples refreshes)
4. El refresh emite un NUEVO refresh token (rotation) y blacklistea el anterior
5. Si se detecta reuso de un refresh token ya rotado, se ejecuta **revocacion nuclear**: se invalidan TODOS los tokens del usuario (posible robo de sesion)

### Cambio de Contraseña (C-28)

El endpoint `POST /api/auth/change-password` requiere JWT y puede ser usado por cualquier rol autenticado.

| Validacion | Codigo | Descripcion |
|------------|--------|-------------|
| `current_password` incorrecto | 400 | "Current password is incorrect" |
| `new_password` igual al actual | 400 | "New password must be different" |
| Politica de seguridad (< 8 chars, sin mayuscula, sin digito) | 400 | Error de validacion |
| Maximo 128 caracteres | 422 | Pydantic validation error |

**Politica minima de contrasenas:**
- Minimo 8 caracteres, maximo 128
- Al menos 1 letra mayuscula
- Al menos 1 digito
- Distinta de la contrasena actual

**Nota de frontend:** El Dashboard valida la politica en el cliente antes de enviar la request para dar feedback inmediato. La validacion backend es autoritativa.

### Table Token para Diners (pwaMenu)

| Parametro | Valor |
|-----------|-------|
| Metodo | HMAC / JWT dual |
| TTL | 3 horas |
| Header | `X-Table-Token: {token}` |
| Contenido | `table_id`, `session_id`, `branch_id`, `tenant_id` |

**Archivos clave:**
- `backend/shared/security/table_token.py` -- generacion y verificacion de tokens
- `pwaMenu/src/services/api.ts` -- envio automatico del header

**Proposito:** Los diners (clientes) no tienen cuenta. El table token les da acceso limitado a operaciones de su mesa (ver menu, agregar items al carrito, enviar rondas) sin requerir login.

### WebSocket Authentication

| Endpoint | Metodo | Estrategia |
|----------|--------|------------|
| `/ws/waiter?token=JWT` | JWT | `JWTAuthStrategy` (roles: WAITER, MANAGER, ADMIN) |
| `/ws/kitchen?token=JWT` | JWT | `JWTAuthStrategy` (roles: KITCHEN, MANAGER, ADMIN) |
| `/ws/admin?token=JWT` | JWT | `JWTAuthStrategy` (roles: ADMIN, MANAGER) |
| `/ws/diner?table_token=` | HMAC | `TableTokenAuthStrategy` |

**Archivos clave:**
- `ws_gateway/components/auth/strategies.py` -- Strategy pattern con `JWTAuthStrategy`, `TableTokenAuthStrategy`, `CompositeAuthStrategy`, `NullAuthStrategy`

**Patron:** Strategy + Chain of Responsibility. El `CompositeAuthStrategy` prueba multiples estrategias en orden; la primera exitosa gana. `NullAuthStrategy` (Null Object pattern) se usa en testing.

### Token Blacklist

| Parametro | Valor |
|-----------|-------|
| Almacenamiento | Redis |
| TTL en Redis | Igual al TTL restante del token |
| Politica fail-closed | Si Redis esta caido, RECHAZAR todos los tokens |

**Archivos clave:**
- `backend/shared/security/auth.py` -- verificacion contra blacklist
- `backend/shared/infrastructure/events.py` -- conexion Redis

**Fail-closed:** Si Redis no esta disponible, la verificacion de blacklist falla cerrada (rechaza el token). Esto previene que tokens revocados sean aceptados durante una caida de Redis.

---

## 2. Autorizacion (RBAC)

### Roles y Permisos

| Rol | Crear | Editar | Eliminar | Scope |
|-----|-------|--------|----------|-------|
| ADMIN | Todo | Todo | Todo | Todas las sucursales del tenant |
| MANAGER | Staff, Tables, Allergens, Promotions | Mismos | Ninguno | Solo sucursales asignadas |
| KITCHEN | Ninguno | Ninguno | Ninguno | Solo sucursales asignadas |
| WAITER | Ninguno | Ninguno | Ninguno | Solo sucursales asignadas + sectores del dia |

### PermissionContext + Strategy Pattern

**Archivos clave:**
- `backend/rest_api/services/permissions/` -- directorio completo
- `backend/rest_api/services/permissions/strategies.py` -- `AdminStrategy`, `ManagerStrategy`, `KitchenStrategy`, `WaiterStrategy`
- `backend/rest_api/services/permissions/__init__.py` -- `PermissionContext`

**Implementacion:**
```python
# Cada rol tiene una estrategia de permisos
STRATEGY_REGISTRY = {
    Roles.ADMIN: AdminStrategy,
    Roles.MANAGER: ManagerStrategy,
    Roles.KITCHEN: KitchenStrategy,
    Roles.WAITER: WaiterStrategy,
}

# Uso en routers
ctx = PermissionContext(user)
ctx.require_management()           # Requiere ADMIN o MANAGER
ctx.require_branch_access(branch_id)  # Verifica acceso a sucursal
```

### Acceso a Nivel de Sucursal

Los usuarios solo pueden acceder a datos de las sucursales a las que estan asignados (`user["branch_ids"]`). ADMIN tiene acceso a todas las sucursales del tenant. MANAGER, KITCHEN y WAITER tienen acceso restringido.

### FSM con Restriccion por Rol

Cada transicion de estado de ronda tiene roles permitidos:

```
PENDING -> CONFIRMED    : WAITER, MANAGER, ADMIN
CONFIRMED -> SUBMITTED  : MANAGER, ADMIN
SUBMITTED -> IN_KITCHEN : KITCHEN, MANAGER, ADMIN
IN_KITCHEN -> READY     : KITCHEN, MANAGER, ADMIN
READY -> SERVED         : WAITER, KITCHEN, MANAGER, ADMIN
* -> CANCELED           : MANAGER, ADMIN
```

**Archivo:** `backend/shared/config/constants.py` -- `ROUND_TRANSITION_ROLES`

---

## 3. Rate Limiting

### Endpoints REST API

| Endpoint | Limite | Metodo | Archivo |
|----------|--------|--------|---------|
| `POST /api/auth/login` | 5/min por IP | slowapi | `backend/rest_api/routers/auth.py` |
| Login por email | 5/min por email | Redis Lua atomico | `backend/rest_api/routers/auth.py` |
| `POST /api/auth/refresh` | 5/min | slowapi | `backend/rest_api/routers/auth.py` |
| `GET /api/public/menu/*` | 100/min | slowapi | `backend/rest_api/routers/public/` |
| Endpoints de billing | 5-20/min (segun endpoint) | slowapi | `backend/rest_api/routers/billing/` |

**Politica fail-closed:** Si Redis no esta disponible para el rate limiting por email, el request se rechaza.

### WebSocket

| Parametro | Valor |
|-----------|-------|
| Limite | 30 mensajes/segundo por conexion |
| Algoritmo | Sliding Window |
| Penalidad por reconexion | Se acumula (previene reseteo de rate limit al reconectarse) |
| Capacidad maxima rastreada | 10,000 conexiones |
| Codigo de cierre | 4029 (rate limited) |

**Archivo:** `ws_gateway/components/connection/rate_limiter.py`

---

## 4. Validacion de Input

### validate_image_url()

**Archivo:** `backend/shared/utils/validators.py`

Bloquea URLs peligrosas para prevenir SSRF:
- IPs internas: `127.0.0.1`, `10.*`, `172.16-31.*`, `192.168.*`, `0.0.0.0`
- Cloud metadata endpoints: `169.254.169.254`, `metadata.google.internal`
- Esquemas peligrosos: `file://`, `ftp://`, `gopher://`, `data:`
- Solo permite `http://` y `https://`

### escape_like_pattern()

**Archivo:** `backend/shared/utils/validators.py`

Escapa caracteres especiales de SQL LIKE (`%`, `_`, `\`) para prevenir inyeccion en queries con LIKE.

### sanitize_search_term()

**Archivo:** `backend/shared/utils/validators.py`

- Maximo 100 caracteres
- Elimina caracteres de control
- Strip de espacios

### validate_quantity()

**Archivo:** `backend/shared/utils/validators.py`

Valida que las cantidades esten en rango 1-99 (previene pedidos absurdos o negativos).

---

## 5. Headers de Seguridad

**Archivo:** `backend/rest_api/core/middlewares.py` -- `SecurityHeadersMiddleware`

| Header | Valor | Proposito |
|--------|-------|-----------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'` | Previene XSS via scripts inyectados |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (solo prod) | Fuerza HTTPS por 1 ano |
| `X-Frame-Options` | `DENY` | Previene clickjacking |
| `X-Content-Type-Options` | `nosniff` | Previene MIME sniffing |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | Desactiva APIs de hardware innecesarias |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limita informacion en referrer |

**Nota:** HSTS solo se activa en produccion (`ENVIRONMENT=production`). En desarrollo se omite para no bloquear HTTP local.

---

## 6. Proteccion SSRF / XSS / CSRF

### SSRF (Server-Side Request Forgery)

| Capa | Mecanismo | Archivo |
|------|-----------|---------|
| Validacion de URLs | `validate_image_url()` con whitelist de dominios | `shared/utils/validators.py` |
| Bloqueo de IPs internas | Rangos RFC 1918 + metadata endpoints | `shared/utils/validators.py` |
| Bloqueo de esquemas | Solo `http://` y `https://` permitidos | `shared/utils/validators.py` |

### XSS (Cross-Site Scripting)

| Capa | Mecanismo | Archivo |
|------|-----------|---------|
| CSP headers | `script-src 'self'` bloquea scripts inline | `rest_api/core/middlewares.py` |
| HttpOnly cookies | Refresh token no accesible via JavaScript | `shared/security/auth.py` |
| React auto-escaping | React escapa contenido HTML por defecto | Framework |

### CSRF (Cross-Site Request Forgery)

| Capa | Mecanismo | Archivo |
|------|-----------|---------|
| SameSite cookies | `SameSite=lax` en refresh token cookie | `shared/security/auth.py` |
| Origin validation (WS) | Verifica header Origin contra lista permitida | `ws_gateway/components/auth/strategies.py` |
| CORS | Solo origenes permitidos pueden hacer requests | `rest_api/main.py` |

**CORS:**
- Produccion: `ALLOWED_ORIGINS` desde variable de entorno
- Desarrollo: localhost defaults (`:5176`, `:5177`, `:5178`, `:8000`, `:8001`)
- **Archivo backend:** `backend/rest_api/main.py` -- `configure_cors()`
- **Archivo WS Gateway:** `ws_gateway/components/core/constants.py` -- `DEFAULT_CORS_ORIGINS`

---

## 7. Endpoints Publicos

Los siguientes endpoints no requieren autenticacion:

| Endpoint | Metodo | Datos Expuestos |
|----------|--------|-----------------|
| `GET /api/health` | GET | Status del servicio (sin datos sensibles) |
| `GET /api/health/detailed` | GET | Status de dependencias (DB, Redis) |
| `GET /api/public/branches` | GET | Nombre, slug y logo de sucursales activas |
| `GET /api/public/menu/{slug}` | GET | Menu publico: categorias, productos, precios |
| `GET /api/public/menu/{slug}/products/{id}` | GET | Detalle de un producto publico |
| `GET /api/public/menu/{slug}/allergens` | GET | Lista de alergenos del menu |

**Evaluacion de seguridad:**
- Solo exponen datos disenados para ser publicos (menu visible al cliente)
- No incluyen datos internos: IDs de tenant, configuraciones, datos de staff
- No permiten modificacion (solo GET)
- Protegidos con rate limiting (100/min)

---

## 8. Gestion de Secrets

### Variables de Entorno Criticas

| Variable | Proposito | Requisito en Produccion |
|----------|-----------|------------------------|
| `JWT_SECRET` | Firma de tokens JWT | 32+ caracteres aleatorios, NO default |
| `TABLE_TOKEN_SECRET` | Firma de table tokens HMAC | 32+ caracteres aleatorios, NO default |
| `MERCADOPAGO_ACCESS_TOKEN` | API de pagos MercadoPago | Token real de produccion |
| `DATABASE_URL` | Conexion a PostgreSQL | URL con credenciales de produccion |
| `REDIS_URL` | Conexion a Redis | URL de produccion |

### Validacion de Secrets en Produccion

**Archivo:** `backend/shared/config/settings.py` -- `validate_production_secrets()`

Al arrancar en `ENVIRONMENT=production`, el sistema verifica:
1. `JWT_SECRET` tiene 32+ caracteres y NO es el valor default (`dev-secret`)
2. `TABLE_TOKEN_SECRET` tiene 32+ caracteres y NO es el valor default
3. `ALLOWED_ORIGINS` esta configurado (no usa defaults de localhost)
4. `COOKIE_SECURE=true` esta activado
5. `DEBUG=false`

Si alguna validacion falla, la aplicacion **no arranca** (fail-fast).

### Separacion de Secrets

El proyecto usa secrets separados para cada proposito:
- `JWT_SECRET` -- exclusivo para tokens JWT de staff
- `TABLE_TOKEN_SECRET` -- exclusivo para table tokens de diners
- `MERCADOPAGO_ACCESS_TOKEN` -- exclusivo para integracion de pagos

Esta separacion garantiza que la compromision de un secret no afecte otros mecanismos de seguridad.

### Docker Compose

**Archivo:** `devOps/docker-compose.yml`

En desarrollo, docker-compose usa `${VAR:-default}` para permitir arranque sin `.env`. En produccion, las variables DEBEN definirse explicitamente en el `.env` o el secret manager del orquestador.

---

## 9. Resumen de Archivos de Seguridad

| Archivo | Responsabilidad |
|---------|-----------------|
| `backend/shared/security/auth.py` | JWT: emision, verificacion, blacklist, refresh rotation |
| `backend/shared/security/table_token.py` | Table token: generacion, verificacion HMAC |
| `backend/rest_api/services/permissions/strategies.py` | RBAC: Strategy pattern por rol |
| `backend/rest_api/services/permissions/__init__.py` | PermissionContext: wrapper de alto nivel |
| `backend/rest_api/core/middlewares.py` | Security headers, content-type validation |
| `backend/rest_api/main.py` | CORS, rate limiting, middleware chain |
| `backend/shared/utils/validators.py` | SSRF prevention, input sanitization |
| `backend/shared/config/settings.py` | Secrets validation, configuracion |
| `backend/shared/config/constants.py` | Roles, FSM transitions, management roles |
| `ws_gateway/components/auth/strategies.py` | WebSocket auth strategies |
| `ws_gateway/components/connection/rate_limiter.py` | WebSocket rate limiting |
| `ws_gateway/components/resilience/circuit_breaker.py` | Circuit breaker para Redis |
| `ws_gateway/components/core/constants.py` | CORS origins, close codes |

---

## Diagrama de Flujo de Autenticacion

```
                    +-------------------+
                    |   Request entrante |
                    +--------+----------+
                             |
                    +--------v----------+
                    | Endpoint publico?  |
                    +--------+----------+
                     SI |          | NO
                        v          v
                  [Procesar]  +----+----+
                              | JWT o   |
                              | Table?  |
                              +----+----+
                           JWT |    | Table Token
                               v    v
                    +----------+  +----------+
                    | verify_  |  | verify_  |
                    | jwt()    |  | table_   |
                    |          |  | token()  |
                    +----+-----+  +----+-----+
                         |             |
                    +----v----+   +----v----+
                    | En      |   | Token   |
                    | blacklist?  | valido? |
                    +----+----+   +----+----+
                  SI |    | NO      NO |  | SI
                     v    v            v  v
                 [401] +--+--+    [401] [Procesar]
                       | RBAC |
                       | check|
                       +--+---+
                    OK |    | Forbidden
                       v    v
                [Procesar] [403]
```
