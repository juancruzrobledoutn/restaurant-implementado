## Why

El proyecto Integrador / Buen Sabor arranca desde cero: no existe codigo de aplicacion, ni estructura de directorios, ni infraestructura local. Sin un scaffolding base operativo, ningun change posterior (C-02 en adelante) puede ejecutarse. Este change establece los cimientos: estructura del monorepo, infraestructura Docker, app minima del backend con health check, frontends scaffoldeados, y CI en GitHub Actions.

## What Changes

- Crear la estructura completa del monorepo: `backend/`, `ws_gateway/`, `Dashboard/`, `pwaMenu/`, `pwaWaiter/`, `shared/`, `devOps/`, `e2e/`
- Backend: FastAPI app minima con endpoint `/api/health`, modulo `shared/` (settings, logger, db, exceptions, constants, auth placeholder), Alembic inicializado sin migraciones
- WS Gateway: FastAPI app minima en puerto 8001 con health check (sin logica WebSocket aun)
- 3 frontends: Vite 7.2 + React 19.2 + TypeScript 5.9 + Zustand 5 + Tailwind 4.1 scaffolding minimo
- pwaMenu: configuracion i18n (es/en/pt) con archivos de locales base
- `shared/`: modulo TypeScript con `BaseWebSocketClient` ABC
- `devOps/docker-compose.yml`: PostgreSQL 16 (pgvector), Redis 7, pgAdmin
- `devOps/backup/backup.sh`: script de backup operativo con rotacion
- `.env.example` en cada sub-proyecto con variables documentadas
- `.github/workflows/ci.yml`: 4 jobs paralelos (backend pytest, Dashboard, pwaMenu, pwaWaiter)
- `backend/tests/conftest.py`: fixtures base para pytest
- JWT_SECRET via `${JWT_SECRET}` sin default hardcodeado en produccion

## Capabilities

### New Capabilities
- `monorepo-structure`: Estructura de directorios del monorepo completa, incluyendo backend (Clean Architecture), ws_gateway, 3 frontends React, shared module, devOps, y e2e
- `backend-foundation`: FastAPI app minima con health check, shared module (settings, db, logger, exceptions, constants), y Alembic inicializado
- `frontend-foundation`: Scaffolding de los 3 frontends con Vite + React 19 + TypeScript + Zustand + Tailwind, incluyendo i18n en pwaMenu
- `docker-infrastructure`: Docker Compose con PostgreSQL 16, Redis 7, y pgAdmin; scripts de backup; variables de entorno por componente
- `ci-pipeline`: GitHub Actions CI con 4 jobs paralelos (backend, Dashboard, pwaMenu, pwaWaiter)

### Modified Capabilities
(ninguna — primer change del proyecto, no hay capabilities existentes)

## Impact

- **Repositorio**: Se crean ~50-70 archivos nuevos que establecen la estructura base del proyecto
- **Dependencias**: Python 3.12 + pip (requirements.txt), Node.js 22 + npm (package.json x4), Docker + Docker Compose
- **Puertos**: 8000 (backend), 8001 (ws_gateway), 5177 (Dashboard), 5176 (pwaMenu), 5178 (pwaWaiter), 5432 (PostgreSQL), 6380 (Redis)
- **CI**: GitHub Actions configurado — los tests corren en push/PR a main y develop
- **Governance**: BAJO — full autonomy, no requiere review especial
- **Non-goals**: Este change NO incluye modelos de datos, migraciones, autenticacion, logica de negocio, ni UI funcional. Esos son scope de C-02 en adelante
