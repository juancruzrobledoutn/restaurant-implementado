## 1. Backend — Estructura y shared module

- [x] 1.1 Crear estructura de directorios: `backend/rest_api/` (con `__init__.py`, `models/__init__.py`, `routers/__init__.py`, `services/domain/__init__.py`), `backend/shared/` (con `config/`, `infrastructure/`, `security/`, `utils/`), `backend/alembic/versions/`, `backend/tests/`
- [x] 1.2 Crear `backend/shared/config/settings.py` con Pydantic Settings (DATABASE_URL, REDIS_URL, JWT_SECRET, TABLE_TOKEN_SECRET, ENVIRONMENT, DEBUG)
- [x] 1.3 Crear `backend/shared/config/logging.py` con `get_logger(name)` — logger centralizado
- [x] 1.4 Crear `backend/shared/config/constants.py` con roles (ADMIN, MANAGER, KITCHEN, WAITER), round status enums, y MANAGEMENT_ROLES set
- [x] 1.5 Crear `backend/shared/infrastructure/db.py` con `get_db()`, `safe_commit(db)`, `SessionLocal`, y `Base = declarative_base()`
- [x] 1.6 Crear `backend/shared/infrastructure/events.py` con `get_redis_pool()` y `publish_event()` (stubs)
- [x] 1.7 Crear `backend/shared/security/auth.py` con stubs de `current_user_context()` y `verify_jwt()` (placeholder para C-03)
- [x] 1.8 Crear `backend/shared/utils/exceptions.py` con `NotFoundError`, `ForbiddenError`, `ValidationError`
- [x] 1.9 Crear `backend/shared/utils/validators.py` con `validate_image_url()` y `escape_like_pattern()` (stubs)

## 2. Backend — FastAPI app y Alembic

- [x] 2.1 Crear `backend/rest_api/main.py` con FastAPI app minima, CORS middleware (origins: localhost 5176/5177/5178), y endpoint `GET /api/health` retornando `{"status": "ok", "version": "0.1.0"}`
- [x] 2.2 Crear `backend/alembic.ini` sin URL hardcodeada (usa `sqlalchemy.url` vacio, el env.py lo sobreescribe)
- [x] 2.3 Crear `backend/alembic/env.py` que importa `Base` de models, lee `DATABASE_URL` de settings, y convierte asyncpg a driver sincrono
- [x] 2.4 Crear `backend/alembic/script.py.mako` (template standard de Alembic)
- [x] 2.5 Crear `backend/requirements.txt` con dependencias: fastapi, uvicorn, sqlalchemy, asyncpg, psycopg, alembic, pydantic-settings, redis, pytest, httpx
- [x] 2.6 Crear `backend/.env.example` con todas las variables documentadas
- [x] 2.7 Crear `backend/pytest.ini` con configuracion basica de pytest

## 3. Backend — Tests

- [x] 3.1 Crear `backend/tests/conftest.py` con fixtures base (TestClient de FastAPI, override de get_db si necesario)
- [x] 3.2 Crear `backend/tests/test_health.py` con test de health check endpoint (GET /api/health retorna 200 y status ok)

## 4. WS Gateway

- [x] 4.1 Crear `ws_gateway/__init__.py` y `ws_gateway/main.py` con FastAPI app minima en puerto 8001 y endpoint `GET /health` retornando `{"status": "ok", "service": "ws_gateway"}`

## 5. Frontends — Dashboard

- [x] 5.1 Crear `Dashboard/` con `package.json` (React 19.2, Vite 7.2, TypeScript 5.9, Zustand 5, Tailwind 4.1, Vitest 4.0), `vite.config.ts` (port 5177), `tsconfig.json`, `index.html`
- [x] 5.2 Crear `Dashboard/src/main.tsx`, `Dashboard/src/App.tsx` (componente minimo con texto "Integrador - Dashboard")
- [x] 5.3 Crear `Dashboard/src/index.css` con `@import "tailwindcss"` y `@theme { --color-primary: #f97316; }`
- [x] 5.4 Crear `Dashboard/src/utils/logger.ts` — logger centralizado (nunca console.*)
- [x] 5.5 Crear `Dashboard/.env.example` con `VITE_API_URL=http://localhost:8000` (SIN /api)

## 6. Frontends — pwaMenu

- [x] 6.1 Crear `pwaMenu/` con `package.json` (mismas deps + react-i18next, i18next), `vite.config.ts` (port 5176), `tsconfig.json`, `index.html`
- [x] 6.2 Crear `pwaMenu/src/main.tsx`, `pwaMenu/src/App.tsx` (componente minimo con texto "Integrador - Menu")
- [x] 6.3 Crear `pwaMenu/src/index.css` con Tailwind + theme
- [x] 6.4 Crear `pwaMenu/src/i18n/index.ts` con configuracion i18next (default: es)
- [x] 6.5 Crear `pwaMenu/src/i18n/locales/es.json`, `en.json`, `pt.json` con keys base (`{"app": {"name": "..."}}`)
- [x] 6.6 Crear `pwaMenu/src/utils/logger.ts`
- [x] 6.7 Crear `pwaMenu/.env.example` con `VITE_API_URL=http://localhost:8000/api` y `VITE_WS_URL=ws://localhost:8001`

## 7. Frontends — pwaWaiter

- [x] 7.1 Crear `pwaWaiter/` con `package.json`, `vite.config.ts` (port 5178), `tsconfig.json`, `index.html`
- [x] 7.2 Crear `pwaWaiter/src/main.tsx`, `pwaWaiter/src/App.tsx` (componente minimo con texto "Integrador - Waiter")
- [x] 7.3 Crear `pwaWaiter/src/index.css` con Tailwind + theme
- [x] 7.4 Crear `pwaWaiter/src/utils/logger.ts`
- [x] 7.5 Crear `pwaWaiter/.env.example` con `VITE_API_URL=http://localhost:8000/api` y `VITE_WS_URL=ws://localhost:8001`

## 8. Shared module y E2E scaffold

- [x] 8.1 Crear `shared/package.json` y `shared/websocket-client.ts` con `BaseWebSocketClient` abstract class
- [x] 8.2 Crear `e2e/package.json` y `e2e/playwright.config.ts` con configuracion base de Playwright

## 9. Docker e Infraestructura

- [x] 9.1 Crear `devOps/docker-compose.yml` con servicios: PostgreSQL 16 (pgvector, port 5432), Redis 7 (port 6380 ext / 6379 int, allkeys-lru, 256MB), pgAdmin
- [x] 9.2 Crear `devOps/.env.example` con todas las variables de Docker Compose documentadas
- [x] 9.3 Crear `devOps/backup/backup.sh` con script de backup PostgreSQL (rotacion 7 diarios, 4 semanales)

## 10. CI Pipeline

- [x] 10.1 Crear `.github/workflows/ci.yml` con 4 jobs paralelos: backend (pytest + PostgreSQL + Redis services), dashboard, pwa-menu, pwa-waiter (cada uno: install, lint, type-check, test:run, build)

## 11. Verificacion final

- [x] 11.1 Verificar que `python -m pytest tests/ -v` pasa en `backend/`
- [x] 11.2 Verificar que `npm install` completa sin errores en Dashboard, pwaMenu, pwaWaiter
- [x] 11.3 Verificar que la estructura de directorios coincide con el checklist del skill monorepo-scaffold
