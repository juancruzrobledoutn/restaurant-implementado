# Quick Reference — Multi-Agent Playbooks

## Decision tree

```
¿Qué necesito hacer?
│
├─ Feature nueva end-to-end (model → UI)
│  └─ Playbook 1: Nuevo Módulo CRUD
│
├─ Arreglar un bug
│  ├─ Bug en 1 sola capa → agente single, no necesita playbook
│  └─ Bug cross-capa → Playbook 2: Bug Fix Cross-Capa
│
├─ Review periódico del proyecto
│  └─ Playbook 3: Auditoría Semanal
│
├─ Preparar deploy
│  └─ Playbook 4: Release Prep
│
└─ Cambio atómico en múltiples archivos
   └─ Playbook 5: Refactor Coordinado
```

## Tips de ejecución

### Maximizar paralelismo
- Los agentes en la misma fase corren simultáneamente (1 mensaje con N tool calls)
- NO serializar lo que puede ir en paralelo
- NO paralelizar lo que tiene dependencias (ej: no crear UI antes que API)

### Pasar contexto correcto
Cada agente necesita:
- Path del proyecto: `{PROJECT_ROOT}`
- Referencias a KB: `knowledge-base/0X-area/`
- Convenciones: `knowledge-base/05-dx/04_convenciones_y_estandares.md`
- Reglas de negocio: `knowledge-base/01-negocio/04_reglas_de_negocio.md`

> **Nota**: Reemplazar `{PROJECT_ROOT}` con el path real del proyecto (ej: `E:\ESCRITORIO\programar\2026\jr2`)

### Engram como memoria compartida

**Antes de arrancar:**
```
mem_context project:integrador limit:5
mem_search query:"{{feature}}" project:integrador
```

**Durante la ejecución:**
- Decisiones importantes → `mem_save type:decision`
- Bugs fixeados → `mem_save type:bugfix`
- Nuevos patterns → `mem_save type:pattern`
- Discoveries → `mem_save type:discovery`

**Al cerrar:**
```
mem_session_summary con: goal, discoveries, accomplished, next_steps, relevant_files
```

### Guardrails por dominio

Según `knowledge-base/` governance:

| Dominio | Autonomía | Notas |
|---------|-----------|-------|
| Auth, Billing, Allergens, Staff | **CRITICO** | 1 agente + approval humana |
| Products, WebSocket, Rate Limiting | **ALTO** | Propone, espera review |
| Orders, Kitchen, Waiter, Tables, Customer | **MEDIO** | Implementa con checkpoints |
| Categories, Sectors, Recipes, Promotions | **BAJO** | Autonomía completa si tests pasan |

## Comandos útiles del proyecto

```bash
# Tests
cd backend && python -m pytest tests/ -v
cd Dashboard && npm run test:run
cd pwaMenu && npm run test:run
cd pwaWaiter && npm run test:run
cd e2e && npx playwright test

# Type checks
cd Dashboard && npm run type-check
cd pwaMenu && npx tsc --noEmit
cd pwaWaiter && npx tsc --noEmit

# Lint
cd Dashboard && npm run lint
cd pwaMenu && npm run lint
cd pwaWaiter && npm run lint

# Build
cd Dashboard && npm run build
cd pwaMenu && npm run build
cd pwaWaiter && npm run build

# Migrations
cd backend && alembic upgrade head
cd backend && alembic revision --autogenerate -m "description"

# Docker
cd devOps && docker compose up -d
cd devOps && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Seed
cd backend && python cli.py db-seed
```

## Anti-patterns (NO hacer)

- ❌ Un solo agente gigante haciendo todo secuencialmente
- ❌ Agentes en paralelo que editan el mismo archivo
- ❌ Crear código sin leer los archivos existentes primero
- ❌ Inventar nuevos patterns en lugar de reutilizar los del proyecto
- ❌ Delegar "entendimiento" al sub-agente sin especificar qué cambiar
- ❌ Paralelizar agentes que dependen del output de otros
- ❌ Olvidar actualizar KB/CLAUDE.md/knowledge-base después del cambio
