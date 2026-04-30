# 05. Integraciones Externas

Este documento describe todas las integraciones externas del sistema, sus configuraciones, flujos de datos y consideraciones de seguridad.

---

## 1. Mercado Pago (Procesamiento de Pagos)

### Descripcion General

Mercado Pago es el procesador de pagos online del sistema. Permite a los comensales pagar su cuenta directamente desde la PWA del menu (pwaMenu) sin interaccion del mozo.

### Componentes Involucrados

| Componente | Archivo | Responsabilidad |
|------------|---------|-----------------|
| Backend | `rest_api/routers/billing.py` | Crear preferencias de pago, recibir webhooks |
| Backend | `rest_api/services/domain/billing_service.py` | Logica de negocio de facturacion |
| Frontend | `pwaMenu/src/services/mercadoPago.ts` | Integracion del SDK de MP |
| Frontend | `pwaMenu/src/pages/PaymentResult.tsx` | Pagina de resultado post-pago |

### Libreria

- **Backend:** `mercadopago` 2.11.0 (SDK oficial de Python)
- **Frontend:** Redireccion a checkout de Mercado Pago (no SDK frontend embebido)

### Variables de Entorno

```bash
# Backend (.env)
MERCADOPAGO_ACCESS_TOKEN=APP_USR-...    # Token de acceso (produccion)
# o
MERCADOPAGO_ACCESS_TOKEN=TEST-...        # Token de acceso (sandbox)

# Frontend (pwaMenu/.env)
VITE_MP_PUBLIC_KEY=APP_USR-...           # Clave publica (produccion)
# o
VITE_MP_PUBLIC_KEY=TEST-...              # Clave publica (sandbox)
```

**Deteccion de modo sandbox:** Si `VITE_MP_PUBLIC_KEY` comienza con `"TEST-"`, el sistema opera en modo sandbox automaticamente.

### Flujo de Pago Completo

```
1. Comensal solicita la cuenta
   pwaMenu → POST /api/billing/check/request
   Backend → Crea Check con Charges → Emite CHECK_REQUESTED (outbox)

2. Comensal elige pagar con Mercado Pago
   pwaMenu → POST /api/billing/payment/preference
   Backend → Crea preferencia via SDK MP → Retorna preference_id + init_point

3. Redireccion al checkout de MP
   pwaMenu → window.location.href = init_point (URL de checkout MP)
   Comensal → Completa el pago en MP

4. Retorno post-pago
   MP → Redirige a /payment/success | /payment/failure | /payment/pending
   pwaMenu → PaymentResult.tsx muestra el resultado

5. Notificacion asincrona (webhook)
   MP → POST /api/billing/payment/webhook (IPN notification)
   Backend → Verifica firma → Actualiza Payment → Emite PAYMENT_APPROVED/REJECTED (outbox)
   
6. Si el pago cubre la totalidad
   Backend → Marca Check como PAID → Emite CHECK_PAID (outbox)
```

### URLs de Retorno

| Resultado | URL |
|-----------|-----|
| Exito | `{FRONTEND_URL}/payment/success?payment_id=...` |
| Fallo | `{FRONTEND_URL}/payment/failure?payment_id=...` |
| Pendiente | `{FRONTEND_URL}/payment/pending?payment_id=...` |

### Moneda y Formato

- **Moneda:** ARS (Pesos Argentinos)
- **Formato interno:** Centavos (enteros). Ej: $125.50 = `12550`
- **Formato para MP:** Pesos (float). Se convierte: `12550 / 100 = 125.50`

### Modelo FIFO de Asignacion

Los pagos se asignan a los cargos (charges) usando el patron FIFO (First In, First Out):

```
Check (cuenta total: $5000)
├── Charge 1: Entrada ($1500) ← Payment 1 ($2000) cubre esto + parte del siguiente
├── Charge 2: Principal ($2500) ← Payment 1 ($500 restante) + Payment 2 ($2000)
└── Charge 3: Postre ($1000) ← Payment 2 ($500 restante) + Payment 3 ($500)
```

### Seguridad

- El webhook de MP NO requiere autenticacion JWT (es llamado por servidores de MP)
- Se verifica la firma HMAC del webhook para autenticidad
- Rate limiting en endpoints de pago: 5 requests/minuto por usuario
- Los montos se calculan en el backend; el frontend nunca envia el monto a cobrar

---

## 2. Redis (Bus de Eventos + Cache)

### Descripcion General

Redis actua como el sistema nervioso central del sistema, facilitando la comunicacion en tiempo real entre la REST API y el WebSocket Gateway, ademas de proveer caching y rate limiting.

### Configuracion

| Parametro | Valor | Razon |
|-----------|-------|-------|
| Version | Redis 7 Alpine | Ligero, con Redis Streams |
| Puerto | 6380 | No-estandar para evitar conflictos con instalaciones locales |
| Persistencia | AOF (Append Only File) | Durabilidad sin sacrificar performance |
| Memoria maxima | 256MB | Suficiente para evento bus + cache |
| Politica de eviccion | `allkeys-lru` | Evicta claves menos usadas al alcanzar el limite |

### Pools de Conexion

| Pool | Tipo | Maximo | Uso |
|------|------|--------|-----|
| Async pool | `aioredis` | 50 conexiones | REST API (publish), WS Gateway (subscribe) |
| Sync pool | `redis-py` | 20 conexiones | Operaciones sincronas (rate limiting) |

### Usos Detallados

#### 2.1 Pub/Sub (Comunicacion entre Servicios)

```
REST API → publish_event(channel, data) → Redis Pub/Sub → WS Gateway → Clientes
```

- **Canales:** Organizados por `branch:{branch_id}` y `session:{session_id}`
- **Formato:** JSON serializado con tipo de evento y payload
- **Garantia:** Best-effort para eventos directos, at-least-once para outbox

#### 2.2 Token Blacklist

```python
# Al hacer logout, el token se agrega a la blacklist
redis.setex(f"blacklist:{token_jti}", ttl=TOKEN_REMAINING_TTL, value="1")

# Al validar un token, se verifica que NO este en blacklist
is_blacklisted = redis.exists(f"blacklist:{token_jti}")
```

**Patron fail-closed:** Si Redis no esta disponible, se RECHAZAN los tokens (no se asume que son validos). Esto previene que un token revocado se use durante una caida de Redis.

#### 2.3 Rate Limiting

Implementado con scripts Lua para atomicidad:

```lua
-- Ventana deslizante de rate limiting
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
    redis.call('ZADD', key, now, now .. math.random())
    redis.call('EXPIRE', key, window)
    return 1  -- Permitido
end
return 0  -- Rate limited
```

**Endpoints con rate limiting:**
- Login: 10 intentos por minuto por IP
- Billing: 5-20 requests por minuto por usuario
- WebSocket messages: 100 mensajes por minuto por conexion

#### 2.4 Session Cache

- Cache de sesiones activas para consultas frecuentes
- TTL configurable por tipo de dato
- Invalidacion automatica al cambiar estado

#### 2.5 Sector Assignment Cache

```python
# Cache de asignaciones de sector (5 minutos TTL)
cache_key = f"sector_assignments:{branch_id}:{date}"
# Evita consultas repetidas a PostgreSQL para routing de eventos
```

#### 2.6 Cola de Eventos (Redis Streams)

Para eventos criticos, se usa Redis Streams como cola:

- Consumer groups para procesamiento distribuido
- At-least-once delivery
- Dead Letter Queue (DLQ) para mensajes que fallan 3+ veces
- Acknowledgement manual tras procesamiento exitoso

---

## 3. PostgreSQL + pgvector

### Descripcion General

PostgreSQL es la base de datos principal del sistema. La extension pgvector habilita busqueda por similitud vectorial para las funcionalidades de IA.

### Configuracion

| Parametro | Valor |
|-----------|-------|
| Version | PostgreSQL 16 |
| Extension | pgvector |
| Puerto | 5432 |
| Pool | SQLAlchemy 2.0 (sync) |
| Driver | psycopg (async-capable) |

### Estructura de Datos

El sistema tiene **18+ modelos** organizados en dominios:

| Dominio | Modelos | Tabla notable |
|---------|---------|---------------|
| Tenancy | Tenant, Branch | - |
| Menu | Category, Subcategory, Product, BranchProduct | - |
| Alergenos | Allergen, ProductAllergen, CrossReaction | - |
| Mesas | Table, TableSession, Diner | - |
| Pedidos | Round, RoundItem | - |
| Cocina | KitchenTicket, KitchenTicketItem | - |
| Facturacion | Check, Charge, Allocation, Payment | `app_check` (evita palabra reservada SQL) |
| Usuarios | User, UserBranchRole | - |
| Sectores | BranchSector, WaiterSectorAssignment | - |
| Promociones | Promotion, PromotionBranch, PromotionItem | - |
| Recetas | Recipe, Ingredient, SubIngredient | - |
| Eventos | OutboxEvent | - |
| Auditoria | AuditLog | - |
| Fidelizacion | Customer | - |
| Servicio | ServiceCall | - |

### Convencion de Soft Delete

Todas las entidades usan `is_active = False` para eliminacion logica:

```python
# Queries raw DEBEN incluir el filtro
.where(Model.is_active.is_(True))

# Repositories lo hacen automaticamente
repo = TenantRepository(Product, db)
products = repo.find_all(tenant_id=1)  # Ya filtra por is_active
```

### pgvector (Embeddings para IA)

```sql
-- Columna de embeddings
ALTER TABLE products ADD COLUMN embedding vector(768);

-- Indice para busqueda por similitud
CREATE INDEX ON products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Busqueda por similitud
SELECT * FROM products
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 5;
```

### Herramienta de Administracion

- **pgAdmin 4** disponible en puerto 5050
- Acceso configurado en `docker-compose.yml`

---

## 4. Ollama (IA / RAG Local)

### Descripcion General

Ollama provee un LLM local para funcionalidades de inteligencia artificial en pwaMenu, como recomendaciones personalizadas y chat asistido.

### Modelos Utilizados

| Modelo | Proposito | Tamano |
|--------|-----------|--------|
| `qwen2.5:7b` | Modelo de chat (generacion de texto) | ~4.7GB |
| `nomic-embed-text` | Modelo de embeddings (vectorizacion) | ~274MB |

### Variables de Entorno

```bash
# Backend (.env)
OLLAMA_URL=http://localhost:11434    # URL del servidor Ollama
EMBED_MODEL=nomic-embed-text         # Modelo para embeddings
CHAT_MODEL=qwen2.5:7b               # Modelo para conversacion
```

### Flujo RAG (Retrieval-Augmented Generation)

```
1. Indexacion (background/startup)
   Productos → nomic-embed-text → Embeddings → pgvector

2. Query del comensal
   "Quiero algo picante sin gluten"
   → nomic-embed-text → Query embedding
   → pgvector (busqueda por similitud coseno)
   → Top-K productos relevantes

3. Generacion de respuesta
   Contexto (productos relevantes) + Pregunta del usuario
   → qwen2.5:7b → Respuesta natural con recomendaciones
```

### Componente Frontend

- `pwaMenu/src/components/AIChat/`: Modal de chat con IA (lazy loaded)
- Solo se carga cuando el usuario interactua con el boton de IA
- Streaming de respuestas para mejor UX

### Consideraciones

- Ollama corre localmente (no requiere API keys externas)
- Requiere GPU para performance aceptable en produccion
- En desarrollo, funciona con CPU pero mas lento
- El servicio es opcional: si Ollama no esta disponible, las funcionalidades de IA se deshabilitan gracefully

---

## 5. Google Fonts

### Descripcion General

Fuentes tipograficas servidas desde CDN de Google, utilizadas en todas las aplicaciones frontend.

### Implementacion

```html
<!-- En index.html de cada frontend -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### Cache por Service Worker

Las fuentes se cachean por el service worker (PWA) con estrategia CacheFirst:

- **Primera carga:** Se descarga del CDN de Google
- **Cargas subsiguientes:** Se sirve desde cache local
- **TTL:** 1 ano (las URLs de Google Fonts incluyen hash de contenido)
- **Beneficio:** Funciona offline despues de la primera carga

---

## 6. Web Vitals (Monitoreo de Performance)

### Descripcion General

Libreria de Google para medir metricas reales de rendimiento del usuario (Real User Metrics - RUM).

### Configuracion

- **Libreria:** `web-vitals` 5.1.0
- **Activacion:** Solo en modo desarrollo (`import.meta.env.DEV`)
- **Ubicacion:** `*/src/main.tsx` en cada frontend

### Metricas Medidas

| Metrica | Nombre Completo | Que Mide | Umbral Bueno |
|---------|----------------|-----------|--------------|
| CLS | Cumulative Layout Shift | Estabilidad visual | < 0.1 |
| FID | First Input Delay | Interactividad | < 100ms |
| FCP | First Contentful Paint | Primera pintura con contenido | < 1.8s |
| LCP | Largest Contentful Paint | Carga del contenido principal | < 2.5s |
| TTFB | Time to First Byte | Tiempo de respuesta del servidor | < 800ms |

### Uso

```typescript
// main.tsx
import { reportWebVitals } from './utils/webVitals'

if (import.meta.env.DEV) {
  reportWebVitals(console.log)
}
```

### Relevancia para PWA

Estas metricas son especialmente importantes para las PWAs (pwaMenu, pwaWaiter) donde la experiencia movil es critica. Un mal CLS puede causar toques accidentales, y un LCP lento genera abandono.

---

## 7. Service Workers (PWA)

### Descripcion General

Las tres aplicaciones frontend son Progressive Web Apps (PWAs) con capacidad offline, instalacion nativa y actualizaciones automaticas.

### Herramientas

- **Plugin:** `vite-plugin-pwa` (integracion con Vite)
- **Runtime:** Workbox (libreria de Google para service workers)

### Estrategias de Cache

| Recurso | Estrategia | TTL | Razon |
|---------|------------|-----|-------|
| Imagenes | CacheFirst | 30 dias | Cambian raramente, priorizar velocidad |
| Fuentes (Google Fonts) | CacheFirst | 1 ano | Inmutables por hash en URL |
| JavaScript/CSS | StaleWhileRevalidate | - | Servir rapido, actualizar en background |
| API calls | NetworkFirst | - | Datos frescos prioritarios, cache como fallback |
| App shell (HTML) | NetworkFirst | - | Siempre intentar la version mas nueva |

### Configuracion Tipica

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10
            }
          }
        ]
      }
    })
  ]
})
```

### Actualizacion Automatica

- El service worker verifica actualizaciones cada **1 hora**
- Tipo de registro: `autoUpdate` (se actualiza sin intervencion del usuario)
- Al detectar una nueva version: descarga en background → activa en proxima navegacion

### Soporte Offline

| App | Nivel de Soporte Offline |
|-----|-------------------------|
| pwaMenu | Menu cacheado (8h TTL), carrito local, reconexion automatica |
| pwaWaiter | Cola de reintentos (retryQueueStore), banner offline, acciones encoladas |
| Dashboard | Limitado (datos en stores persisten, pero operaciones requieren red) |

### pwaWaiter - Cola de Reintentos Offline

```typescript
// retryQueueStore.ts
// Cuando no hay conexion, las acciones se encolan
retryQueue.enqueue({
  action: 'UPDATE_ROUND_STATUS',
  payload: { roundId: 123, status: 'CONFIRMED' },
  timestamp: Date.now()
})

// Al recuperar conexion, se procesan en orden FIFO
retryQueue.processAll()
```

### Componentes PWA en pwaWaiter

| Componente | Proposito |
|------------|-----------|
| `PWAManager.tsx` | Gestion de instalacion (prompt "Agregar a pantalla de inicio") |
| `OfflineBanner.tsx` | Banner visual cuando no hay conexion a internet |
| `ConnectionBanner.tsx` | Estado de la conexion WebSocket (conectado/reconectando) |

---

## Diagrama de Integraciones

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   pwaMenu    │     │  pwaWaiter   │     │  Dashboard   │
│              │     │              │     │              │
│ Service Worker│    │ Service Worker│    │ Service Worker│
│ Web Vitals   │     │ Web Vitals   │     │ Web Vitals   │
│ Google Fonts │     │ Google Fonts │     │ Google Fonts │
│ MP Redirect  │     │              │     │              │
│ AI Chat      │     │              │     │              │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │ HTTP/WS            │ HTTP/WS            │ HTTP/WS
       │                    │                    │
┌──────┴────────────────────┴────────────────────┴───────┐
│                    REST API + WS Gateway                 │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ MP SDK      │  │ Ollama      │  │ Outbox          │ │
│  │ (pagos)     │  │ (IA/RAG)    │  │ (eventos)       │ │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
└─────────┼────────────────┼───────────────────┼──────────┘
          │                │                   │
  ┌───────▼──────┐  ┌─────▼──────┐    ┌───────▼──────┐
  │ Mercado Pago │  │   Ollama   │    │    Redis 7   │
  │  (externo)   │  │  (local)   │    │  (Pub/Sub,   │
  │              │  │  qwen2.5   │    │   Cache,     │
  │  Sandbox /   │  │  nomic-    │    │   Blacklist, │
  │  Produccion  │  │  embed     │    │   Streams)   │
  └──────────────┘  └────────────┘    └──────────────┘
                                             │
                                      ┌──────▼──────┐
                                      │ PostgreSQL  │
                                      │ 16+pgvector │
                                      │             │
                                      │ 18 modelos  │
                                      │ Embeddings  │
                                      │ Outbox tbl  │
                                      └─────────────┘
```

---

## Resumen de Variables de Entorno por Integracion

| Integracion | Variable | Ubicacion | Ejemplo |
|-------------|----------|-----------|---------|
| Mercado Pago | `MERCADOPAGO_ACCESS_TOKEN` | backend/.env | `APP_USR-...` o `TEST-...` |
| Mercado Pago | `VITE_MP_PUBLIC_KEY` | pwaMenu/.env | `APP_USR-...` o `TEST-...` |
| Redis | `REDIS_URL` | backend/.env | `redis://localhost:6380/0` |
| PostgreSQL | `DATABASE_URL` | backend/.env | `postgresql://user:pass@localhost:5432/db` |
| Ollama | `OLLAMA_URL` | backend/.env | `http://localhost:11434` |
| Ollama | `EMBED_MODEL` | backend/.env | `nomic-embed-text` |
| Ollama | `CHAT_MODEL` | backend/.env | `qwen2.5:7b` |
| JWT | `JWT_SECRET` | backend/.env | `<32+ caracteres aleatorios>` |
| Table Token | `TABLE_TOKEN_SECRET` | backend/.env | `<32+ caracteres aleatorios>` |
| CORS | `ALLOWED_ORIGINS` | backend/.env | `https://tudominio.com` |
| General | `DEBUG` | backend/.env | `false` (produccion) |
| General | `ENVIRONMENT` | backend/.env | `production` |
| Cookies | `COOKIE_SECURE` | backend/.env | `true` (produccion) |
