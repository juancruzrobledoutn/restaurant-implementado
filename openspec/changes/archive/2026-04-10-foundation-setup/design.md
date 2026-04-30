## Context

El proyecto Integrador / Buen Sabor es un monorepo multi-tenant para gestion de restaurantes. Actualmente el repositorio solo contiene documentacion (knowledge-base), configuracion de OpenSpec, y skills de agentes. No existe codigo de aplicacion.

Este change (C-01) establece la estructura base del monorepo y la infraestructura minima para que los changes posteriores (C-02 core-models, C-03 auth, etc.) puedan ejecutarse sobre una base solida.

La estructura objetivo esta documentada en `knowledge-base/07-anexos/02_estructura_del_codigo.md` y el skill `monorepo-scaffold` provee templates concretos.

## Goals / Non-Goals

**Goals:**
- Estructura de directorios completa que refleje la arquitectura objetivo del monorepo
- Backend FastAPI operativo con un unico endpoint `/api/health`
- Modulo `shared/` con settings (Pydantic Settings), logger, db session factory, exceptions base, y constants (roles, estados)
- Alembic inicializado con `env.py` dinamico que lee `DATABASE_URL` de settings (sin URL hardcodeada en alembic.ini)
- WS Gateway como app FastAPI minima con health check en puerto 8001
- 3 frontends scaffoldeados con Vite 7.2 + React 19.2 + TypeScript 5.9 + Zustand 5 + Tailwind 4.1
- pwaMenu con i18n configurado (es/en/pt) usando archivos de locales base
- Modulo TypeScript compartido (`shared/`) con `BaseWebSocketClient` ABC
- Docker Compose operativo con PostgreSQL 16 (pgvector), Redis 7, y pgAdmin
- CI con GitHub Actions: 4 jobs paralelos
- `.env.example` en cada sub-proyecto

**Non-Goals:**
- Modelos de datos (scope de C-02)
- Autenticacion o seguridad (scope de C-03)
- Logica de negocio en cualquier capa
- UI funcional en los frontends (solo scaffolding minimo)
- Migraciones de Alembic (solo el setup, sin migraciones concretas)
- Configuracion de PWA (service workers, manifest) — se hara cuando cada frontend lo necesite
- DevContainer (se puede agregar despues, no es critico para empezar)

## Decisions

### 1. Driver de PostgreSQL: psycopg (sincrono) para Alembic, asyncpg para la app

**Decision**: Usar `postgresql+psycopg` en Alembic y `postgresql+asyncpg` en la app FastAPI.

**Alternativas consideradas**:
- Solo asyncpg para todo: Alembic no soporta async nativamente, requiere hacks con `run_async`
- Solo psycopg para todo: Funciona pero pierde las ventajas de async en FastAPI

**Razon**: Alembic es un proceso CLI sincrono. FastAPI se beneficia de async. El `env.py` convierte la URL automaticamente con `.replace("asyncpg", "psycopg")`.

### 2. Settings via Pydantic Settings (no dotenv manual)

**Decision**: `pydantic-settings` con `BaseSettings` para toda configuracion del backend.

**Razon**: Validacion de tipos automatica, valores por defecto seguros, y lectura de `.env` sin codigo extra. Ademas permite validaciones de produccion (JWT_SECRET >= 32 chars, DEBUG=false, etc.) en un solo lugar.

### 3. Monorepo plano (no workspaces npm)

**Decision**: Cada frontend tiene su propio `package.json` independiente. No usar npm/pnpm workspaces.

**Alternativas consideradas**:
- pnpm workspaces: Reduce duplicacion de `node_modules` pero agrega complejidad de configuracion
- Turborepo: Potente pero overkill para 3 frontends que rara vez comparten codigo directamente

**Razon**: Los 3 frontends son apps independientes con stacks casi identicos pero funcionalidades muy distintas. La unica dependencia compartida es el modulo `shared/` que se importa via path relativo. La simplicidad de `npm install` en cada directorio es mas valiosa que la optimizacion de espacio.

### 4. Tailwind 4.1 con CSS nativo (sin tailwind.config.ts)

**Decision**: Tailwind 4.x usa su configuracion directamente en CSS (`@theme`), no en un archivo JS/TS.

**Razon**: Tailwind 4 es un CSS-first framework. La configuracion via `tailwind.config.ts` es legacy. El theme se define en `src/index.css` con `@import "tailwindcss"` y `@theme { --color-primary: #f97316; }`.

### 5. Logger centralizado desde el dia 0

**Decision**: Backend usa `get_logger()` (shared/config/logging.py). Frontends usan `utils/logger.ts`. NUNCA `console.*` ni `print()`.

**Razon**: Convencion no-negociable del proyecto. Establecerlo en C-01 evita que changes posteriores empiecen con malas practicas.

### 6. Redis en puerto 6380 (externo)

**Decision**: Redis mapea internamente 6379 al puerto externo 6380 en Docker Compose.

**Razon**: Evitar conflictos con instancias Redis locales en el puerto default 6379. Internamente en Docker los servicios siguen usando 6379.

## Risks / Trade-offs

**[Versionado de dependencias]** Las versiones exactas de React 19.2, Vite 7.2, TypeScript 5.9, etc. pueden no estar disponibles al momento de ejecutar `npm install` si el ecosistema avanza rapido.
- Mitigacion: Usar rangos con caret (`^19.2.0`) y documentar versiones minimas en `.env.example`.

**[Settings placeholder]** El `shared/config/settings.py` incluye campos como `JWT_SECRET` que no se usan hasta C-03. Podrian causar confusion sobre que esta "implementado" vs. que es placeholder.
- Mitigacion: Comentarios claros en el codigo indicando que son placeholders para changes futuros.

**[CI sin tests reales]** El pipeline de CI corre `pytest` y `vitest run` pero en C-01 no hay tests sustantivos. Los jobs pueden dar falsos positivos (pasan porque no hay nada que falle).
- Mitigacion: Incluir al menos un test de health check en backend y un test trivial en cada frontend para validar que el setup funciona.

**[Alembic sin modelos]** Alembic queda inicializado pero sin migraciones. El `env.py` importa `Base` de models, que en C-01 es un `declarative_base()` vacio.
- Mitigacion: Esto es intencional. C-02 agrega los modelos y genera la primera migracion.
