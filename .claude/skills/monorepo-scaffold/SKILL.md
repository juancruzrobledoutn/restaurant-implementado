---
name: monorepo-scaffold
description: >
  Guía para crear la estructura completa del monorepo Integrador desde cero.
  Trigger: change C-01 foundation-setup — primer change del proyecto.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use
- Change C-01 foundation-setup únicamente
- Crear el monorepo completo desde cero: backend, ws_gateway, 3 frontends, shared, devOps, CI

## Estructura de directorios a crear

```
<repo-destino>/
├── backend/
│   ├── rest_api/
│   │   ├── __init__.py
│   │   ├── main.py          ← FastAPI app mínima con /api/health
│   │   ├── models/
│   │   │   └── __init__.py
│   │   ├── routers/
│   │   │   └── __init__.py
│   │   └── services/
│   │       └── domain/
│   │           └── __init__.py
│   ├── shared/
│   │   ├── config/
│   │   │   ├── settings.py  ← Pydantic Settings
│   │   │   ├── constants.py ← Roles, RoundStatus, MANAGEMENT_ROLES
│   │   │   └── logging.py   ← get_logger()
│   │   ├── infrastructure/
│   │   │   ├── db.py        ← get_db(), safe_commit(), SessionLocal
│   │   │   └── events.py    ← get_redis_pool(), publish_event()
│   │   ├── security/
│   │   │   └── auth.py      ← current_user_context, verify_jwt
│   │   └── utils/
│   │       ├── exceptions.py ← NotFoundError, ForbiddenError, ValidationError
│   │       ├── admin_schemas.py
│   │       └── validators.py ← validate_image_url, escape_like_pattern
│   ├── alembic/
│   │   ├── env.py           ← imports Base, lee DATABASE_URL dinámicamente
│   │   ├── script.py.mako
│   │   └── versions/        ← vacío, migraciones se generan en C-02
│   ├── tests/
│   │   └── conftest.py      ← fixtures de DB y Redis para tests
│   ├── alembic.ini
│   ├── requirements.txt
│   ├── pytest.ini
│   └── .env.example
├── ws_gateway/
│   ├── main.py              ← FastAPI app mínima puerto 8001
│   └── __init__.py
├── Dashboard/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── stores/
│   │   ├── services/
│   │   └── utils/
│   │       └── logger.ts    ← logger centralizado, nunca console.*
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── .env.example
├── pwaMenu/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── i18n/
│   │       ├── index.ts
│   │       └── locales/
│   │           ├── es.json
│   │           ├── en.json
│   │           └── pt.json
│   ├── package.json
│   ├── vite.config.ts      ← incluye vite-plugin-pwa
│   └── .env.example
├── pwaWaiter/
│   ├── src/
│   │   ├── main.tsx
│   │   └── App.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── .env.example
├── shared/                  ← módulo TypeScript compartido
│   ├── websocket-client.ts  ← BaseWebSocketClient ABC
│   └── package.json
├── devOps/
│   ├── docker-compose.yml   ← ya existe en BaseJR — copiar al repo destino
│   └── .env.example
├── e2e/
│   ├── package.json
│   └── playwright.config.ts
└── .github/
    └── workflows/
        └── ci.yml           ← 4 jobs paralelos
```

## backend/rest_api/main.py — template mínimo

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Integrador API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5177", "http://localhost:5176", "http://localhost:5178"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "0.1.0"}
```

## backend/shared/config/settings.py — Pydantic Settings

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://user:password@localhost:5432/integrador"
    REDIS_URL: str = "redis://localhost:6380"
    JWT_SECRET: str = "dev-secret-change-in-production"
    TABLE_TOKEN_SECRET: str = "dev-table-secret-change-in-production"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    class Config:
        env_file = ".env"

settings = Settings()
```

## backend/alembic/env.py — configuración crítica

```python
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import sys, os

# CRÍTICO: importar todos los modelos para que Alembic los detecte
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rest_api.models import Base  # noqa — importa todos los modelos via __init__.py
from shared.config.settings import settings

config = context.config
fileConfig(config.config_file_name)
target_metadata = Base.metadata

def get_url():
    # Alembic usa la URL sincrónica (no asyncpg)
    return settings.DATABASE_URL.replace("postgresql+asyncpg", "postgresql")

def run_migrations_offline():
    context.configure(url=get_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(configuration, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

## .github/workflows/ci.yml — 4 jobs paralelos

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: user
          POSTGRES_PASSWORD: password
          POSTGRES_DB: menu_ops_test
        ports: ["5432:5432"]
      redis:
        image: redis:7-alpine
        ports: ["6380:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: cd backend && pip install -r requirements.txt
      - run: cd backend && python -m pytest tests/ -v --tb=short
        env:
          ENVIRONMENT: test
          DATABASE_URL: postgresql+asyncpg://user:password@localhost:5432/menu_ops_test
          REDIS_URL: redis://localhost:6380

  dashboard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - run: cd Dashboard && npm install
      - run: cd Dashboard && npm run lint
      - run: cd Dashboard && npm run type-check
      - run: cd Dashboard && npm run test:run
      - run: cd Dashboard && npm run build

  pwa-menu:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - run: cd pwaMenu && npm install
      - run: cd pwaMenu && npm run lint
      - run: cd pwaMenu && npm run type-check
      - run: cd pwaMenu && npm run test:run
      - run: cd pwaMenu && npm run build

  pwa-waiter:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - run: cd pwaWaiter && npm install
      - run: cd pwaWaiter && npm run lint
      - run: cd pwaWaiter && npm run type-check
      - run: cd pwaWaiter && npm run test:run
      - run: cd pwaWaiter && npm run build
```

## package.json base para frontends (Dashboard como referencia)

```json
{
  "name": "dashboard",
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint . --ext ts,tsx",
    "type-check": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vite": "^7.2.0",
    "vitest": "^4.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "tailwindcss": "^4.1.0",
    "babel-plugin-react-compiler": "latest",
    "eslint-plugin-react-hooks": "^7.0.0"
  }
}
```

## Checklist de C-01

- [ ] Estructura de directorios creada completa
- [ ] `backend/rest_api/main.py` con `/api/health` operativo
- [ ] `backend/shared/` completo (settings, db, auth, exceptions, constants, logger)
- [ ] `backend/alembic/` inicializado con `env.py` dinámico (sin URL hardcodeada en alembic.ini)
- [ ] `backend/tests/conftest.py` con fixtures base
- [ ] 3 frontends scaffoldeados con Vite + React 19 + TypeScript
- [ ] `pwaMenu/src/i18n/` con locales es/en/pt (archivos vacíos o con keys base)
- [ ] `shared/websocket-client.ts` con BaseWebSocketClient ABC vacío
- [ ] `devOps/docker-compose.yml` copiado desde BaseJR/devOps/
- [ ] `devOps/.env.example` con todas las variables documentadas
- [ ] `.github/workflows/ci.yml` con 4 jobs paralelos
- [ ] `docker compose up -d` levanta sin errores
- [ ] `GET http://localhost:8000/api/health` responde `{"status": "ok"}`
- [ ] Todos los `npm install` sin errores en los 3 frontends
- [ ] `python -m pytest tests/ -v` pasa (tests vacíos o de health check)
