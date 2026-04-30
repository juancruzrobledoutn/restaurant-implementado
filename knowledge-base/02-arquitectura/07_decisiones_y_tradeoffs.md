# Decisiones Técnicas y Tradeoffs

Cada decisión arquitectónica en Integrador fue tomada con un propósito específico. Este documento registra las decisiones más importantes en formato ADR (Architecture Decision Record), incluyendo contexto, razonamiento, alternativas evaluadas, tradeoffs aceptados y consecuencias. Sirve como referencia para entender POR QUÉ el sistema es como es.

> Mientras las decisiones explican el razonamiento, los tradeoffs se enfocan en las CONSECUENCIAS: qué ganamos, qué perdimos, y dónde podría dolernos en el futuro.

---

## Infraestructura

### ADR-01: Monorepo

**Contexto:** Se necesitaba decidir cómo organizar los 5+ componentes del sistema (Dashboard, pwaMenu, pwaWaiter, backend, ws_gateway).

**Decisión:** Monorepo — todos los componentes viven en un único repositorio.

**Lo que se ganó:**
- Coordinación de cambios: un cambio cross-cutting se hace en un solo PR
- Documentación centralizada: un solo CLAUDE.md, un solo knowledge-base
- Refactoring atómico: renombrar un endpoint afecta backend y frontends en un solo commit
- Onboarding simplificado: un `git clone` y tenés todo el proyecto

**Lo que se perdió:**
- Deploy independiente: no se puede deployar pwaMenu sin deployar todo lo demás
- CI/CD granular: un cambio en el README ejecuta pipelines de todo el proyecto
- Ownership claro: las responsabilidades se diluyen

**Riesgo latente:** A medida que el equipo crece, los merge conflicts aumentan exponencialmente. Si el equipo supera 5-6 desarrolladores, considerar CODEOWNERS o migrar a polyrepo.

---

### ADR-02: Docker Compose para Orquestación

**Contexto:** Se necesitaba una forma de levantar todos los servicios (DB, Redis, API, WS) de forma reproducible.

**Decisión:** Docker Compose con `devOps/docker-compose.yml` orquestando todos los servicios. Overlay `docker-compose.prod.yml` para producción con replicas y nginx.

**Tradeoffs:** Simplicidad de desarrollo (un comando levanta todo) vs menor control que Kubernetes para escalado dinámico. Aceptable para el volumen actual.

---

### ADR-03: PostgreSQL + pgvector vs Base de Datos Vectorial Dedicada

**Contexto:** Las funcionalidades de IA (chatbot, búsqueda semántica) requieren almacenamiento de vectores.

**Decisión:** pgvector como extensión de PostgreSQL.

**Lo que se ganó:**
- Una sola base de datos: no hay otro servicio que administrar, monitorear o backupear
- SQL familiar: las consultas vectoriales se integran con JOINs, WHEREs y todo el poder de SQL
- Transaccionalidad: los embeddings participan en transacciones ACID junto con los datos de negocio

**Lo que se perdió:**
- Rendimiento a escala: Pinecone, Weaviate o Qdrant son significativamente más rápidos para millones de vectores
- Funcionalidades avanzadas: búsqueda híbrida, re-ranking, clustering nativo
- Índices optimizados: pgvector soporta IVFFlat y HNSW, pero las DBs especializadas tienen más opciones

**Umbral para migrar:** Si los vectores superan 1 millón o las consultas vectoriales exceden 50ms p99.

---

## Backend

### ADR-04: FastAPI sobre Django y Flask

**Contexto:** Se necesitaba un framework backend en Python con soporte async nativo, especialmente para el WebSocket Gateway.

**Decisión:** FastAPI como framework web principal.

**Razonamiento:**
- **Async nativo**: corre sobre Starlette (ASGI), `async/await` sin hacks. Crítico para el WS Gateway con cientos de conexiones simultáneas
- **Documentación automática**: OpenAPI/Swagger generado a partir de type hints y schemas Pydantic
- **Pydantic integrado**: validación declarativa que sirve como validación, documentación y serialización
- **Rendimiento**: comparable a Node.js y Go para operaciones I/O-bound

**Alternativas evaluadas:**

| Framework | Por qué se descartó |
|-----------|-------------------|
| Django | Demasiado opinionado. ORM propio (no SQLAlchemy). Soporte async incompleto. |
| Flask | Síncrono por defecto. Sin validación de tipos nativa. Sin docs automáticas. |
| Express (Node.js) | Se prefirió un solo lenguaje en backend. SQLAlchemy es superior a los ORMs de Node.js para consultas complejas. |

**Tradeoffs:** Ecosistema más chico que Django, no tiene admin panel built-in, comunidad más joven.

---

### ADR-05: Gateway WebSocket Separado

**Contexto:** El sistema requiere comunicación en tiempo real para múltiples funcionalidades.

**Decisión:** Servicio WebSocket independiente (puerto 8001) separado de la API REST (puerto 8000).

**Razonamiento:**
- **Separación de concerns**: request-response vs conexiones persistentes son patrones fundamentalmente distintos
- **Escalado independiente**: el Gateway puede necesitar más recursos cuando hay muchos comensales
- **Optimizaciones especializadas**: worker pool, sharded locks, circuit breaker solo tienen sentido para conexiones persistentes
- **Código compartido**: módulos comunes en `backend/shared/` importados via `PYTHONPATH`

**Alternativas evaluadas:**

| Enfoque | Por qué se descartó |
|---------|-------------------|
| WebSocket en el mismo servidor FastAPI | Acoplamiento. No se puede escalar independientemente. |
| Socket.io | Demasiado pesado. Abstracciones innecesarias. |
| Server-Sent Events (SSE) | Unidireccional. El carrito compartido necesita comunicación bidireccional. |

**Tradeoffs:** Un servicio más para desplegar, necesidad de `PYTHONPATH`, dos puntos de autenticación independientes.

**Riesgo latente:** Gateway centralizado es SPOF. Con 1000+ conexiones simultáneas puede ser cuello de botella. Mitigación: sticky sessions con load balancer y Redis Streams para múltiples consumers.

---

### ADR-06: Transactional Outbox para Eventos Críticos

**Contexto:** Los eventos financieros (facturación, pagos) no pueden perderse. Un pago registrado pero no notificado causa inconsistencias críticas.

**Decisión:** Patrón Transactional Outbox para eventos críticos (CHECK_REQUESTED, CHECK_PAID, PAYMENT_*, ROUND_SUBMITTED, ROUND_READY, SERVICE_CALL_CREATED).

**Razonamiento:**
- **Atomicidad garantizada**: el evento se escribe en la misma transacción que los datos de negocio
- **Desacople temporal**: si Redis está caído, los eventos se acumulan y se publican cuando vuelva
- **Auditoría**: la tabla outbox sirve como log de eventos financieros

**Alternativas evaluadas:**

| Enfoque | Por qué se descartó |
|---------|-------------------|
| Publicar directo a Redis después del commit | Si Redis falla entre commit y publish, el evento se pierde. Inaceptable para pagos. |
| Event sourcing completo | Complejidad desproporcionada. Requiere CQRS, proyecciones, snapshots. |
| Kafka/RabbitMQ | Infraestructura adicional. Redis es suficiente para este volumen. |

**Tradeoffs:** Tabla adicional en BD, procesador background necesario, latencia ligeramente mayor.

---

### ADR-07: Redis Directo para Eventos No Críticos

**Contexto:** Muchos eventos (carrito, estado de mesa, CRUD) no requieren garantía de entrega. La baja latencia es más importante.

**Decisión:** Publicación directa a Redis para eventos no críticos (CART_*, TABLE_*, ENTITY_*, ROUND_CONFIRMED/IN_KITCHEN/SERVED).

**Razonamiento:** Latencia mínima (~1ms vs ~50ms del outbox), simplicidad (una línea), pérdida aceptable (el comensal puede refrescar).

**Riesgo:** Si Redis cae momentáneamente, estos eventos se pierden. El equipo debe saber claramente qué patrón usar para cada tipo de evento nuevo.

| Clasificación errónea | Consecuencia |
|----------------------|--------------|
| Evento crítico tratado como best-effort | Pérdida de datos financieros si Redis falla |
| Evento no crítico tratado como outbox | Latencia innecesaria, tabla outbox crece |

---

### ADR-08: Multi-Tenancy a Nivel de Aplicación

**Contexto:** El modelo de negocio es SaaS: múltiples restaurantes usan la misma instancia.

**Decisión:** Multi-tenancy a nivel de aplicación con `tenant_id` en todas las tablas de negocio.

**Lo que se ganó:**
- Infraestructura simple: una sola BD, un solo pool, un solo backup
- Costo operativo bajo: no hay que provisionar bases por tenant
- Queries cross-tenant triviales para analytics

**Lo que se perdió:**
- Seguridad por defecto: si un dev olvida filtrar por `tenant_id`, se exponen datos ajenos
- Row-Level Security: PostgreSQL ofrece RLS pero no se usa por complejidad con SQLAlchemy
- Performance predecible: un tenant con millones de registros impacta a todos

**Riesgo latente:** La fuga de datos entre tenants es el riesgo MÁS CRÍTICO del sistema. Mitigación actual: `TenantRepository` y `BranchRepository` agregan filtro automáticamente, pero queries manuales con `db.execute(select(...))` no tienen esta protección.

**Mitigación futura recomendada:** Implementar Row-Level Security como segunda capa de defensa.

---

### ADR-09: Soft Delete en Todas las Entidades

**Contexto:** Los datos de un restaurante tienen valor histórico. Una categoría eliminada puede tener productos asociados que aparecen en pedidos pasados.

**Decisión:** Soft delete (`is_active = False`) por defecto. Hard delete solo para registros efímeros (items del carrito, sesiones expiradas).

**Razonamiento:** Integridad referencial (pedidos históricos referencian productos inactivos), auditoría (siempre se sabe qué existió), recuperación (un error humano se revierte cambiando un flag).

**Tradeoffs:** TODAS las consultas deben filtrar por `is_active = True`. La BD crece continuamente. `cascade_soft_delete` agrega complejidad.

---

### ADR-10: Precios en Centavos

**Contexto:** Los precios deben almacenarse y calcularse sin errores de redondeo.

**Decisión:** Todos los precios como enteros en centavos ($125.50 = 12550).

**Razonamiento:** Aritmética de enteros es exacta (no hay `0.1 + 0.2 = 0.30000000000000004`). Estándar de la industria (Stripe, MercadoPago).

**Tradeoffs:** Cada frontend debe convertir centavos a display y viceversa. Es fácil introducir bugs si alguien olvida la conversión.

---

## Frontend

### ADR-11: React 19 con React Compiler

**Contexto:** Los tres frontends necesitaban un framework de UI reactivo y performante.

**Decisión:** React 19.2 con `babel-plugin-react-compiler` habilitado en los tres frontends.

**Razonamiento:**
- Auto-memoización: elimina necesidad de `React.memo`, `useMemo` y `useCallback` manuales
- Nuevas APIs: `useActionState` y `useOptimistic` simplifican formularios y actualizaciones optimistas
- Futuro del ecosistema: adoptarlo temprano evita migración dolorosa

**Alternativas evaluadas:**

| Framework | Por qué se descartó |
|-----------|-------------------|
| React 18 | Sin compilador, sin nuevas APIs. Migración inevitable. |
| Vue 3 | Ecosistema más chico. Menos candidatos para contratar. |
| Angular | Demasiado opinionado para equipo chico. Bundle size mayor. |
| Svelte | Ecosistema inmaduro para aplicaciones empresariales. |

**Riesgo latente:** Bleeding edge — si una librería crítica resulta incompatible, opciones: esperar actualización, fork, o desactivar compilador para esa parte.

---

### ADR-12: Zustand sobre Redux

**Contexto:** Los tres frontends necesitan state management para sesión, carrito, mesas, pedidos y autenticación.

**Decisión:** Zustand 5.0 como librería de state management.

**Razonamiento:**
- Simplicidad radical: un store es un hook. Boilerplate 10x menor que Redux
- Tamaño: 2KB vs 40KB+ de Redux Toolkit. Significativo en PWAs
- Selectores: previenen re-renders innecesarios de forma natural
- Compatibilidad: funciona perfectamente con React 19 Compiler

**Alternativas evaluadas:**

| Librería | Por qué se descartó |
|----------|-------------------|
| Redux Toolkit | Demasiado boilerplate. Actions, reducers, slices, middleware. Overkill para equipos chicos. |
| Jotai | Fragmenta el estado en demasiadas piezas. Zustand permite stores coherentes por dominio. |
| React Context | No tiene selectores. Cualquier cambio re-renderiza todos los consumidores. |
| Signals (Preact) | No nativo de React. Futuro incierto. |

**Tradeoffs:** Menos devtools que Redux (no hay time-travel debugging), menos middleware disponible, requiere disciplina con selectores (nunca destructurar).

---

### ADR-13: Stores Modulares en Zustand (pwaMenu)

**Contexto:** El store principal de pwaMenu creció a 800+ líneas, mezclando tipos, lógica, selectores y helpers.

**Decisión:** Dividir cada store en archivos: `store.ts`, `types.ts`, `selectors.ts`, `helpers.ts`.

**Razonamiento:** Mantenibilidad (cada archivo con responsabilidad clara), testabilidad (selectores y helpers son funciones puras), navegación (más fácil encontrar un selector en `selectors.ts`).

**Tradeoffs:** Más archivos para navegar (4 por store), import paths más largos, requiere convención de equipo.

---

### ADR-14: PWA sobre Aplicaciones Nativas

**Contexto:** Clientes (pwaMenu) y mozos (pwaWaiter) necesitan acceder desde celulares.

**Decisión:** Progressive Web Apps para todos los frontends mobile.

**Lo que se ganó:**
- Sin app stores: actualizaciones instantáneas, sin proceso de revisión
- Cross-platform: un mismo código para iOS, Android y desktop
- Offline-capable: Service Workers para funcionalidad offline (crítico para pwaWaiter con WiFi inestable)
- Costo: un equipo en lugar de tres

**Lo que se perdió:**
- Push notifications limitadas (especialmente en iOS)
- Sin acceso a APIs nativas avanzadas (NFC, Bluetooth)
- Limitaciones de Safari con Service Worker

---

### ADR-15: Confirmación Grupal para Pedidos (pwaMenu)

**Contexto:** En el carrito compartido, múltiples comensales agregan items simultáneamente. Si cualquiera puede enviar, se puede enviar un pedido incompleto accidentalmente.

**Decisión:** Flujo de confirmación grupal: un comensal propone enviar, los demás tienen 5 minutos para confirmar o rechazar.

**Razonamiento:** Prevención de errores (nadie envía sin consentimiento), transparencia (todos ven la propuesta), timeout (si no se confirma en 5 minutos, expira sin bloquear).

**Tradeoffs:** Fricción adicional en el flujo, latencia extra antes de que llegue a cocina, complejidad de UI para manejar estados de propuesta/confirmación/expiración.

---

## Seguridad

### ADR-16: Dual Auth: JWT + HMAC Table Tokens

**Contexto:** Dos tipos de usuarios fundamentalmente distintos: staff con cuentas persistentes, y clientes que escanean QR sin registro.

**Decisión:** JWT con refresh token para staff. HMAC table tokens para clientes.

**Razonamiento:**
- Staff (JWT): sesiones persistentes, roles, permisos. Estándar de la industria
- Clientes (Table Token): zero-friction. Escanean QR, obtienen token de 3 horas
- Separación clara: `Authorization: Bearer` para staff, `X-Table-Token` para clientes

**Tradeoffs:** Dos estrategias para mantener y testear, table tokens menos seguros (compartibles), WS Gateway valida ambos tipos.

**Riesgo latente:** Cuando se implemente fidelización (Phase 4), migrar de sesiones anónimas a cuentas identificadas será complejo. Hay que vincular `device_id` históricos con cuentas nuevas respetando GDPR.

---

### ADR-17: HttpOnly Cookies para Refresh Tokens

**Contexto:** Se necesitaba almacenar refresh tokens de forma segura.

**Decisión:** HttpOnly Cookies.

**Lo que se ganó:**
- Inmunidad a XSS: JavaScript no puede leer cookies HttpOnly
- Estándar OWASP para tokens sensibles
- Envío automático por el navegador

**Lo que se perdió:**
- Vulnerabilidad a CSRF: mitigado con header `X-Requested-With`
- Complejidad CORS: `credentials: 'include'` requiere configuración explícita
- Depuración más difícil: no aparecen en `document.cookie`

**Riesgo latente:** En producción con múltiples subdominios, la configuración de cookies requiere `SameSite`, `Domain` y `Path` correctos. Mala configuración puede causar que las cookies no se envíen.

---

### ADR-18: Refresh Proactivo de Tokens

**Contexto:** El access token JWT tiene 15 minutos de vida. Un refresh reactivo (después de un 401) causa error momentáneo visible al usuario.

**Decisión:** Refresh proactivo a los 14 minutos (1 minuto antes de la expiración).

**Razonamiento:** Experiencia invisible (el usuario nunca percibe el refresh), reducción de 401s (solo quedan los genuinamente inválidos), resiliencia (queda 1 minuto de margen si falla).

**Tradeoffs:** Requests adicionales cada 14 minutos, necesidad de jitter para evitar thundering herd, timer se pierde si el usuario cierra y reabre la pestaña.

---

## Real-time

### ADR-19: Worker Pool Broadcast (WebSocket Gateway)

**Contexto:** Enviar un mensaje a 400 usuarios secuencialmente tomaba ~4 segundos. Inaceptable.

**Decisión:** Worker pool de 10 workers para broadcast paralelo.

**Razonamiento:** Reducción de ~4s a ~160ms (mejora 25x), no bloquea el event loop, backpressure natural por cola.

**Tradeoffs:** Código más complejo, gestión de colas y workers agrega puntos de falla, reencola mensajes si un worker falla.

---

### ADR-20: Sharded Locks (WebSocket Gateway)

**Contexto:** Un lock global causaba 90% de contención con muchos usuarios conectando/desconectando simultáneamente.

**Decisión:** Locks granulares por sucursal y por usuario.

**Razonamiento:** Operaciones en sucursal A no bloquean sucursal B. Contención se mantiene constante independientemente del total de conexiones.

**Tradeoffs:** Más memoria para mapas de locks, disciplina requerida en orden de adquisición para prevenir deadlocks, debugging más complejo.

---

### ADR-21: Circuit Breaker para Redis

**Contexto:** Si Redis cae, el WebSocket Gateway no debe colapsar.

**Decisión:** Circuit breaker con tres estados: CLOSED → OPEN (tras 5 fallos) → HALF_OPEN (a los 30s) → CLOSED.

**Razonamiento:** Resiliencia (el Gateway sigue aceptando conexiones), fail-fast (no espera timeouts), auto-recuperación (prueba después de 30s).

**Tradeoffs:** Eventos se pierden durante estado OPEN (ventana de 30s), complejidad adicional, delay de recuperación es compromiso entre velocidad y estabilidad.

---

### ADR-22: Enrutamiento de Eventos por Sector

**Contexto:** Un restaurante con 10 sectores y 20 mozos no necesita que cada mozo reciba eventos de todos los sectores.

**Decisión:** Filtrado de eventos WebSocket por `sector_id` basado en asignaciones diarias.

**Razonamiento:** Reducción de ruido (mozo solo ve sus mesas), ahorro de ancho de banda, excepciones lógicas (ADMIN/MANAGER reciben todo).

**Tradeoffs:** Cache de asignaciones necesario (TTL 5 min), reasignación dinámica durante turno requiere comando WebSocket específico.

---

### ADR-23: Offline-First en pwaWaiter

**Contexto:** Los mozos necesitan seguir operando durante caídas momentáneas de WiFi.

**Decisión:** Offline-first con cola de retry.

**Lo que se ganó:**
- Continuidad operativa: el mozo toma pedidos sin conexión, se encolan y envían al reconectar
- Experiencia predecible: nunca muestra "Sin conexión"

**Lo que se perdió:**
- Complejidad de sincronización: acciones encoladas pueden conflictuar con cambios online
- Datos potencialmente stale durante periodo offline
- Ordering de eventos: acciones FIFO pero estado del servidor puede haber cambiado

**Riesgo latente:** Mozo offline 5 minutos podría enviar pedido a mesa ya cerrada. Mitigación: backend valida estado de sesión y retorna error específico.

---

## Matriz Resumen de Riesgos

| Tradeoff | Impacto si sale mal | Probabilidad | Severidad | Mitigación |
|----------|---------------------|-------------|-----------|------------|
| Monorepo | Merge conflicts, deploy acoplado | Media (crece con equipo) | Media | CODEOWNERS, CI selectivo |
| App-level multi-tenancy | Fuga de datos entre tenants | Baja (repos filtran) | Crítica | RLS como segunda capa |
| Híbrido outbox/Redis | Evento crítico perdido | Baja | Alta | Tabla de clasificación clara |
| Sesión sin cuenta | No hay fidelización | Segura (by design) | Media | Phase 4 del roadmap |
| Gateway centralizado | SPOF en tiempo real | Media | Alta | Sticky sessions + réplicas |
| Offline-first pwaWaiter | Conflictos de sincronización | Media | Media | Validación server-side |
| React 19 bleeding edge | Incompatibilidad de librería | Baja-Media | Media | Fallback a desactivar compiler |
| pgvector vs DB especializada | Performance insuficiente para IA | Baja (escala actual) | Baja | Umbral definido para migrar |
| HttpOnly cookies | Problemas CORS multi-dominio | Media (en prod) | Media | Testing exhaustivo pre-deploy |

---

## Conclusión

Ningún tradeoff es permanente. Cada decisión puede reevaluarse cuando el contexto cambie: el equipo crezca, el volumen de datos aumente, o los requisitos de negocio evolucionen. Lo importante es que cada decisión fue tomada conscientemente, documentada con sus riesgos, y con un plan de mitigación identificado.

El peor tradeoff es el que se hace sin saberlo. Este documento existe para que eso no ocurra.
