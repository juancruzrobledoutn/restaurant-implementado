# 02. Superficie de Ataque

Documento de referencia que enumera todos los puntos de entrada al sistema, headers aceptados, inputs procesados, integraciones externas y brechas identificadas.

---

## Endpoints REST (161 totales)

### Endpoints publicos (sin autenticacion) — 7

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/health` | GET | Health check del REST API |
| `/ws/health` | GET | Health check del WebSocket Gateway |
| `/api/public/branches` | GET | Listado de sucursales (pre-login pwaWaiter) |
| `/api/public/menu/{slug}` | GET | Menu publico por slug de sucursal |
| `/api/public/menu/{slug}/categories` | GET | Categorias del menu publico |
| `/api/public/menu/{slug}/products` | GET | Productos del menu publico |
| `/api/public/menu/{slug}/allergens` | GET | Alergenos del menu publico |

### Distribucion por metodo HTTP

| Metodo | Cantidad | Proposito |
|--------|----------|-----------|
| GET | ~78 | Lectura de datos, listados, busquedas |
| POST | ~47 | Creacion de entidades, login, acciones |
| PATCH | ~16 | Actualizacion parcial de entidades |
| DELETE | ~18 | Soft delete (desactivacion logica) |
| PUT | ~2 | Reemplazo completo de entidades |
| **Total** | **161** | |

### Agrupacion por dominio

| Dominio | Prefijo | Auth | Roles |
|---------|---------|------|-------|
| Autenticacion | `/api/auth/*` | Publico (login), JWT (refresh, me) | Todos |
| Admin CRUD | `/api/admin/*` | JWT | ADMIN, MANAGER (limitado) |
| Mozo | `/api/waiter/*` | JWT | WAITER, MANAGER, ADMIN |
| Cocina | `/api/kitchen/*` | JWT | KITCHEN, MANAGER, ADMIN |
| Comensal | `/api/diner/*` | X-Table-Token | Comensales con sesion activa |
| Cliente (loyalty) | `/api/customer/*` | X-Table-Token | Comensales registrados |
| Facturacion | `/api/billing/*` | JWT o X-Table-Token | Segun endpoint |
| Recetas | `/api/recipes/*` | JWT | KITCHEN, MANAGER, ADMIN |
| Menu publico | `/api/public/*` | Ninguna | Cualquiera |

---

## WebSocket (4 endpoints)

| Endpoint | Auth | Roles permitidos | Proposito |
|----------|------|-------------------|-----------|
| `/ws/waiter?token=JWT` | JWT | WAITER, MANAGER, ADMIN | Notificaciones de pedidos, llamadas de servicio, mesas |
| `/ws/kitchen?token=JWT` | JWT | KITCHEN, MANAGER, ADMIN | Tickets de cocina, estados de rondas |
| `/ws/admin?token=JWT` | JWT | MANAGER, ADMIN | CRUD en tiempo real, metricas |
| `/ws/diner?table_token=` | Table Token | Comensales con sesion | Sincronizacion de carrito, estados de pedido |

### Limites WebSocket

| Parametro | Valor |
|-----------|-------|
| Rate limit | 30 mensajes/segundo por conexion |
| Heartbeat interval | 30 segundos (cliente envia `ping`) |
| Server timeout | 60 segundos sin actividad |
| Close code: auth fallida | 4001 |
| Close code: forbidden | 4003 |
| Close code: rate limited | 4029 |

---

## Headers aceptados

### Headers de autenticacion

| Header | Formato | Uso |
|--------|---------|-----|
| `Authorization` | `Bearer {JWT}` | Dashboard, pwaWaiter, endpoints admin/waiter/kitchen |
| `X-Table-Token` | Token HMAC/JWT | pwaMenu, endpoints diner/customer/billing |

### Headers funcionales

| Header | Formato | Uso |
|--------|---------|-----|
| `X-Request-ID` | UUID v4 | Correlacion de requests en logs distribuidos |
| `X-Requested-With` | `XMLHttpRequest` | Mitigacion CSRF (validado en endpoints sensibles) |
| `X-Device-Id` | UUID v4 | Tracking de dispositivo para loyalty (pwaMenu) |
| `X-Idempotency-Key` | UUID v4 | Prevencion de submissions duplicados (rondas) |
| `Content-Type` | `application/json` o `application/x-www-form-urlencoded` | Validado obligatoriamente en POST/PUT/PATCH |

### Headers de seguridad (respuesta)

| Header | Valor | Proposito |
|--------|-------|-----------|
| `Content-Security-Policy` | Restrictivo (unsafe-inline para styles) | Prevencion XSS |
| `Strict-Transport-Security` | `max-age=31536000` (solo produccion) | Forzar HTTPS |
| `X-Frame-Options` | `DENY` | Prevencion clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevencion MIME sniffing |

---

## Inputs de usuario procesados

| Input | Origen | Validacion | Limite |
|-------|--------|------------|--------|
| Email/password | Login form | Formato email, bcrypt hash | Rate limited por IP |
| Nombres de comensales | pwaMenu JoinTable | Texto libre, sanitizado | Max 50 caracteres |
| Notas de pedido | pwaMenu CartItem | Texto libre, sanitizado | Max 200 caracteres |
| URLs de imagenes | Dashboard ProductEditor | `validate_image_url()` contra SSRF | Bloquea IPs internas, metadata cloud |
| Busqueda de productos | pwaMenu SearchBar | `escape_like_pattern()`, sanitizado | Max 100 caracteres |
| Codigos de mesa | QR scan / pwaWaiter | Alfanumerico, uppercase | Max 10 caracteres |
| Montos de pago | pwaWaiter PaymentModal | Numerico, centavos (int) | Validado contra total de cuenta |
| Slugs de sucursal | URL path | Alfanumerico + guiones | Validado contra DB |

---

## Integraciones externas

| Integracion | Endpoint | Direccion | Seguridad |
|-------------|----------|-----------|-----------|
| Mercado Pago | `POST /mercadopago/webhook` | Inbound (webhook) | Firma HMAC verificada contra secret |
| Ollama API | Interno (localhost) | Outbound | Experimental, solo red local |
| Redis | Puerto 6380 (interno) | Bidireccional | No expuesto externamente, sin auth en dev |
| PostgreSQL | Puerto 5432 (interno) | Bidireccional | No expuesto externamente, credenciales en .env |

---

## Tokens y sesiones

| Token | Lifetime | Storage | Renovacion |
|-------|----------|---------|------------|
| Access Token (JWT) | 15 minutos | Memory (frontend) | Proactiva cada 14 min |
| Refresh Token | 7 dias | HttpOnly cookie | Automatica en refresh |
| Table Token | 3 horas | localStorage (pwaMenu) | No renovable (nueva sesion) |
| Token blacklist | TTL del token | Redis | Fail-closed (si Redis cae, tokens rechazados) |

---

## Gaps identificados

### Severidad alta

| Gap | Riesgo | Mitigacion actual | Recomendacion |
|-----|--------|-------------------|---------------|
| No hay MFA/2FA para cuentas admin | Compromiso de credenciales = acceso total | Password + JWT | Implementar TOTP o WebAuthn para roles ADMIN/MANAGER |
| No hay endpoint de password reset | Usuarios no pueden recuperar acceso | Intervencion manual | Implementar flujo reset con token por email |
| Webhook signing secret = JWT_SECRET | Compromiso de un secret afecta ambos | Separacion logica | Usar `MERCADOPAGO_WEBHOOK_SECRET` independiente |

### Severidad media

| Gap | Riesgo | Mitigacion actual | Recomendacion |
|-----|--------|-------------------|---------------|
| Sin rate limiting en admin CRUD | Abuso de endpoints autenticados | Requiere JWT valido | Agregar rate limiting por usuario (ej: 100 req/min) |
| CSP permite `unsafe-inline` styles | Vectores XSS via estilos inline | Tailwind lo requiere | Migrar a nonces CSP cuando sea viable |
| WebSocket Origin spoofable | Conexiones desde origen no autorizado | JWT valida identidad post-conexion | Aceptable: JWT es la barrera real |

### Severidad baja

| Gap | Riesgo | Mitigacion actual | Recomendacion |
|-----|--------|-------------------|---------------|
| Redis sin auth en dev | Acceso no autorizado en dev | Solo localhost | Agregar password en produccion (ya configurado en .env) |
| No hay audit log persistente | Sin trazabilidad de acciones admin | Logs de aplicacion | Implementar tabla de audit trail |
| localStorage para Table Token | XSS puede robar token de comensal | Token expira en 3h, scope limitado | Aceptable dado el modelo de amenazas |
