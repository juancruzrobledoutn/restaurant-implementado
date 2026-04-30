# Agent Skills — Guía de Uso

Todas las skills del proyecto viven en `.agents/skills/` — una sola ubicación.
Claude Code las detecta automáticamente al abrir el proyecto.

---

## Cuándo cargar cada skill

| Contexto de trabajo | Skills a cargar |
|---------------------|----------------|
| Cualquier change de backend (SIEMPRE) | `clean-architecture` |
| Creando un Domain Service o router FastAPI | `fastapi-domain-service` + `fastapi-code-review` |
| Changes que tocan Redis (cache, eventos, rate limiting) | `redis-best-practices` |
| Changes en ws_gateway | `websocket-engineer` |
| Changes en pwaMenu o pwaWaiter | `pwa-development` |
| Cualquier frontend React | `vercel-react-best-practices` |
| Creando o modificando un store Zustand | `zustand-store-pattern` |
| Creando una página CRUD en Dashboard | `dashboard-crud-page` + `react19-form-pattern` + `help-system-content` |
| Change C-01 foundation-setup (scaffolding inicial) | `monorepo-scaffold` |
| Cualquier change con modelos SQLAlchemy (C-02 a C-13) | `alembic-migrations` |
| Creando formularios en cualquier frontend | `react19-form-pattern` |
| Conectando componentes a eventos WebSocket | `ws-frontend-subscription` |
| Diseñando nuevas páginas o componentes UI | `interface-design` |
| Creando proposals o definiendo scope | `agile-product-owner` |
| Antes de escribir cualquier feature | `test-driven-development` |
| Ante cualquier bug o test fallando | `systematic-debugging` |
| Tests de backend (pytest) | `python-testing-patterns` |
| Tests E2E | `playwright-best-practices` |
| Nuevas migraciones o diseño de tablas | `postgresql-table-design` |
| Queries lentas o N+1 | `postgresql-optimization` |
| Changes de auth, billing, endpoints públicos | `api-security-best-practices` |
| Modificando Dockerfiles | `multi-stage-dockerfile` |
| Al preparar un PR | `requesting-code-review` |
| Al recibir feedback de un PR | `receiving-code-review` |

## Reglas de prioridad

1. **Cargar ANTES de escribir código**, no después
2. Múltiples skills pueden aplicar simultáneamente — cargarlas todas
3. `clean-architecture` aplica a TODO change de backend, sin excepción
4. En conflicto → `clean-architecture` prevalece en backend, `vercel-react-best-practices` en frontend

---

## Inventario completo — `.agents/skills/`

### Domain skills (proyecto-específicas)

| Skill | Dominio | Cuándo |
|-------|---------|--------|
| `clean-architecture/` | Capas, dependencias, separación de responsabilidades | Backend siempre |
| `fastapi-domain-service/` | Template Domain Service + router thin + imports canónicos | Backend — crear servicios |
| `fastapi-code-review/` | Review de routers, services, middlewares | Backend — revisar código |
| `pwa-development/` | PWA, service workers, offline, push notifications | pwaMenu, pwaWaiter |
| `redis-best-practices/` | Cache, Pub/Sub, rate limiting, TTL, Lua scripts | Backend + ws_gateway |
| `websocket-engineer/` | WS Gateway, broadcast, auth strategies, heartbeat | ws_gateway |
| `vercel-react-best-practices/` | React 19, Vite, TypeScript — patrones generales | Todos los frontends |
| `zustand-store-pattern/` | Selectores, useShallow, EMPTY_ARRAY, persist + migrate | Cualquier store |
| `dashboard-crud-page/` | Hook trio, useActionState, cascade delete, a11y checklist | Dashboard pages |
| `react19-form-pattern/` | useActionState en los 3 frontends, FormData, validación | Cualquier formulario |
| `ws-frontend-subscription/` | Ref pattern, subscribe once, onFiltered, throttle | Componentes con WS |
| `help-system-content/` | HelpButton obligatorio + estructura helpContent.tsx | Dashboard — cualquier página |
| `interface-design/` | UI/UX, componentes, accesibilidad | Nuevas páginas |
| `agile-product-owner/` | Scope, non-goals, acceptance criteria | Fase de planning |
| `monorepo-scaffold/` | Estructura completa del monorepo desde cero, CI, Alembic init | C-01 únicamente |
| `alembic-migrations/` | Workflow Alembic: env.py dinámico, autogenerate, cadena, tests | C-02 a C-13 |
| `openspec-propose/` | Workflow de `/opsx:propose` | Al proponer un change |
| `openspec-apply-change/` | Workflow de `/opsx:apply` | Al implementar un change |
| `openspec-archive-change/` | Workflow de `/opsx:archive` | Al archivar un change |
| `openspec-explore/` | Workflow de `/opsx:explore` | Al explorar ideas |

### Ecosystem skills (skills.sh)

| Skill | Tier | Cuándo |
|-------|------|--------|
| `systematic-debugging/` | 1 | Cualquier bug o comportamiento inesperado |
| `test-driven-development/` | 1 | Antes de escribir cualquier feature |
| `python-testing-patterns/` | 1 | Tests backend: pytest, fixtures, mocking |
| `playwright-best-practices/` | 1 | Tests E2E |
| `requesting-code-review/` | 1 | Al preparar un PR |
| `receiving-code-review/` | 1 | Al procesar feedback |
| `code-review-excellence/` | 1 | Al revisar código de otro |
| `fastapi-templates/` | 2 | Patrones avanzados FastAPI |
| `typescript-advanced-types/` | 2 | Tipos complejos en frontends |
| `postgresql-table-design/` | 2 | Diseño de tablas, migraciones |
| `postgresql-optimization/` | 2 | Queries lentas, índices, EXPLAIN |
| `tailwind-design-system/` | 2 | Design system Tailwind 4.1 |
| `api-security-best-practices/` | 2 | Auth, billing, endpoints críticos |
| `multi-stage-dockerfile/` | 2 | Optimización de imágenes Docker |
| `find-skills/` | util | Buscar nuevas skills del ecosistema |
