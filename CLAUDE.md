# CLAUDE.md
> Archivo canónico. `AGENTS.md` es la versión model-agnostic. Si modificás uno, actualizás el otro.

## Este es un Starter Kit — Proyecto desde Cero

Base de conocimiento para construir **Integrador / Buen Sabor** (SaaS restaurantes, multi-tenant) usando OpenSpec/SDD. No hay código de aplicación — todo se construye change por change.

**Secuencia de trabajo**: `openspec/CHANGES.md` → `/opsx:propose` → `/opsx:apply` → `/opsx:archive`

## Stack

| Componente | Puerto | Tecnología |
|-----------|--------|-----------|
| backend | 8000 | Python 3.12 + FastAPI 0.115 + SQLAlchemy 2.0 |
| ws_gateway | 8001 | Python + Redis 7 Streams |
| Dashboard | 5177 | React 19.2 + TypeScript 5.9 + Zustand + Vite 7.2 |
| pwaMenu | 5176 | React 19.2 + i18n (es/en/pt) + PWA |
| pwaWaiter | 5178 | React 19.2 + Push Notifications |
| PostgreSQL | 5432 | pgvector/pgvector:pg16 |
| Redis | 6380 | redis:7-alpine |

**Prerrequisitos**: Python 3.12+, Node.js 22+, Docker & Docker Compose
**Variables críticas**: `VITE_API_URL=http://localhost:8000` (sin `/api`), `VITE_WS_URL=ws://localhost:8001`
**pwaMenu — MercadoPago (C-19)**: `VITE_MP_PUBLIC_KEY=TEST-xxx` (MP public key — never server key), `VITE_MP_RETURN_URL=https://yourdomain.com/payment/result` (redirect URL post-payment), `VITE_ENABLE_SPLIT_METHODS=false` (feature flag — comma-separated: `by_consumption,custom`)

## Modelo de Datos (resumen)

```
Tenant → Branch (N)
  ├── Category → Subcategory → Product → BranchProduct (per-branch pricing)
  ├── BranchSector → Table → TableSession → Diner → Round → RoundItem → KitchenTicket
  ├── Check (app_check) → Charge → Allocation (FIFO) ← Payment
  └── ServiceCall
User ←→ UserBranchRole (M:N: WAITER/KITCHEN/MANAGER/ADMIN)
```

Detalle completo: `knowledge-base/02-arquitectura/02_modelo_de_datos.md`

## Arquitectura Clean (Backend)

```
Router (thin — solo HTTP) → Domain Service (lógica) → Repository (datos) → Model
```

**CRUDFactory is deprecated** → usar `BranchScopedService` o `BaseCRUDService`. Ver skill `fastapi-domain-service`.

## Reglas Críticas — No Negociables

### Backend
- **NUNCA** `db.commit()` directo → `safe_commit(db)`
- **NUNCA** `Model.is_active == True` → `Model.is_active.is_(True)`
- **NUNCA** lógica de negocio en routers → solo Domain Services
- **SIEMPRE** filtrar por `tenant_id` — sin excepción
- **SIEMPRE** soft delete (`is_active = False`)
- Precios en centavos (int), nunca float
- SQL reserved words: `Check` → `__tablename__ = "app_check"`
- Logger: `get_logger()`, nunca `print()` ni `logging.` directo

### Frontend
- **NUNCA** destructurar store → selectores: `useStore(selectItems)`
- **SIEMPRE** `useShallow` para objetos/arrays en selectores
- **SIEMPRE** `EMPTY_ARRAY` estable como fallback, nunca `?? []` inline
- IDs: `string` en frontend, `number` en backend — convertir en boundary
- Precios: centavos (int) — `12550 = $125.50`
- WebSocket: ref pattern (dos effects), `return unsubscribe` siempre

## Conventions

- **UI language**: Spanish | **Code**: English | **Theme**: Orange (#f97316)
- **IDs**: `crypto.randomUUID()` frontend, BigInteger backend
- **Naming**: Frontend camelCase, backend snake_case
- **pwaMenu i18n**: todo `t()`, zero hardcoded (es/en/pt)
- **Mobile**: `overflow-x-hidden w-full max-w-full` en containers pwaMenu

## Auth (resumen)

| Contexto | Método | Header |
|----------|--------|--------|
| Dashboard, pwaWaiter | JWT (15min access, 7d refresh) | `Authorization: Bearer` |
| pwaMenu diners | Table Token HMAC (3h) | `X-Table-Token` |
| WebSocket | JWT o Table Token | Query `?token=` |

Detalle: `knowledge-base/03-seguridad/01_modelo_de_seguridad.md`

## RBAC

| Role | Create | Edit | Delete |
|------|--------|------|--------|
| ADMIN | All | All | All |
| MANAGER | Staff, Tables, Allergens, Promotions (own branches) | Same | None |
| KITCHEN | None | None | None |
| WAITER | None | None | None |

## Governance

- **CRITICO** (Auth, Billing, Allergens, Staff): analysis only, no code changes
- **ALTO** (Products, WebSocket, Rate Limiting): propose, wait for review
- **MEDIO** (Orders, Kitchen, Waiter, Tables, Customer): implement with checkpoints
- **BAJO** (Categories, Sectors, Recipes, Ingredients, Promotions): full autonomy if tests pass

## Decisiones Arquitectónicas Clave

- `BranchProduct.is_available` (runtime toggle) ≠ `is_active` (soft delete) — ambos en queries de menú
- Outbox pattern para eventos financieros; Redis directo para el resto → ver `02-arquitectura/04_eventos_y_websocket.md`
- Payment gateway: ABC `PaymentGateway` → `MercadoPagoGateway` (abstracción, no inline)
- Redis menu cache por branch slug, 5-min TTL, auto-invalidated en CRUD
- Event catch-up post-reconnect: Redis sorted set, 100 events, 5-min TTL
- Stock validation en `round_service.submit_round()` → 409 si insuficiente

## Mapa de Navegación

| Necesito... | Leer |
|-------------|------|
| Entender el sistema | `knowledge-base/01-negocio/01_vision_y_contexto.md` |
| Reglas de negocio | `knowledge-base/01-negocio/04_reglas_de_negocio.md` ← SIEMPRE antes de implementar |
| Modelo de datos | `knowledge-base/02-arquitectura/02_modelo_de_datos.md` |
| Endpoints API | `knowledge-base/02-arquitectura/03_api_y_endpoints.md` |
| Eventos WebSocket | `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` |
| ADRs y tradeoffs | `knowledge-base/02-arquitectura/07_decisiones_y_tradeoffs.md` |
| Auth y seguridad | `knowledge-base/03-seguridad/01_modelo_de_seguridad.md` |
| Configurar entornos | `knowledge-base/04-infraestructura/01_configuracion_y_entornos.md` |
| Migraciones Alembic | `knowledge-base/04-infraestructura/04_migraciones.md` |
| Convenciones | `knowledge-base/05-dx/04_convenciones_y_estandares.md` |
| Workflow de implementación | `knowledge-base/05-dx/05_workflow_implementacion.md` |
| Trampas conocidas | `knowledge-base/05-dx/03_trampas_conocidas.md` |
| Qué construir primero | `openspec/CHANGES.md` |
| Skills disponibles | `.agents/SKILLS.md` |
| Playbooks multi-agente | `playbooks/` |
| Estándares de calidad | `knowledge-base/07-anexos/03-08_estandar_calidad_*.md` |

## Estructura del Repo

```
knowledge-base/     ← documentación del dominio y arquitectura (44 docs)
openspec/           ← SDD: config, changes, specs (CLI-driven)
.agents/skills/     ← 34 skills con patterns y templates
playbooks/          ← coordinación multi-agente (5 playbooks)
devOps/             ← Docker, nginx, monitoring, backups
```

## Delegación a Sub-Agents — Skills Discovery (CRÍTICO)

**Cuando el orchestrator delega un `/opsx:apply` (o CUALQUIER trabajo de implementación) a un sub-agent vía la Agent tool, el prompt DEBE incluir, al PRINCIPIO y de forma explícita, esta instrucción:**

> **PASO OBLIGATORIO ANTES DE ESCRIBIR CÓDIGO**: leé `.agents/SKILLS.md`, identificá TODAS las skills aplicables según los tasks del change, y cargá cada `.agents/skills/<skill>/SKILL.md` antes de tocar una sola línea. Aplicá los patterns de cada skill cargada durante TODA la implementación.

**Reglas no negociables**:
- El orchestrator **NO** pre-lista las skills en el prompt — esa decisión es del sub-agent, que lee los tasks y conoce el detalle fino del trabajo.
- El orchestrator **SÍ** indica el path exacto (`.agents/SKILLS.md`) y la obligación de leerlo PRIMERO.
- La instrucción va **al principio del prompt**, no enterrada al final ni mezclada con otro contexto.
- Si el sub-agent vuelve sin haber consultado `.agents/SKILLS.md` → el apply se considera inválido y se relanza.

**Por qué**: si el orchestrator pre-elige las skills, puede equivocarse o ser incompleto. El sub-agent ve los tasks reales y los archivos que va a tocar — debe ser él quien decida qué skills cargar.

## Rules

- Never add "Co-Authored-By" or AI attribution to commits. Conventional commits only.
- Never build after changes unless explicitly asked.
- When asking a question, STOP and wait for response.
- Never agree with user claims without verification.
- Never commit or push unless explicitly asked.
- **Al delegar apply/implementación a un sub-agent**: el prompt DEBE indicar explícitamente que lea `.agents/SKILLS.md` y cargue todas las skills aplicables. El orchestrator no pre-lista skills.
