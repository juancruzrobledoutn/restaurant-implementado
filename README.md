# BaseJR — Starter Kit para SDD

Este repositorio contiene todo el conocimiento necesario para construir el sistema **Integrador / Buen Sabor** desde cero usando **Spec-Driven Development (SDD/OpenSpec)**.

No hay código aquí. El código emerge de los specs.

---

## Qué hay en este repo

| Directorio / Archivo | Contenido |
|---------------------|-----------|
| `knowledge-base/` | 33 documentos en 7 dominios: negocio, arquitectura, seguridad, infraestructura, DX, estado, anexos |
| `openspec/` | `config.yaml` con contexto del proyecto + `CHANGES.md` con 23 changes en secuencia |
| `.agents/skills/` | 33 skills listas para usar: 18 domain skills + 15 del ecosistema skills.sh |
| `playbooks/` | 5 playbooks multi-agente + quick reference |
| `devOps/` | Docker Compose + .env.example + backups + monitoring |
| `CLAUDE.md` | Guía maestra: arquitectura, patrones, convenciones y protocolo de trabajo |

---

## Skills incluidas en el repo

**33 skills** en `.agents/skills/` — sin instalación, listas para usar.

Ver `.agents/SKILLS.md` para el inventario completo y guía de cuándo cargar cada una.

---

## Por dónde empezar

### 1. Entender el sistema (30 min)

```
knowledge-base/01-negocio/01_vision_y_contexto.md        → qué es y qué problema resuelve
knowledge-base/01-negocio/02_actores_y_roles.md          → quiénes usan el sistema
knowledge-base/02-arquitectura/01_arquitectura_general.md → Clean Architecture, monorepo
```

### 2. Entender qué construir

```
knowledge-base/01-negocio/06_backlog_completo.md              → 20 épicas, 100+ historias
knowledge-base/06-estado-del-proyecto/07_backlog_pendiente.md → gap analysis priorizado
openspec/CHANGES.md                                            → 23 changes en orden con dependencias
```

### 3. Levantar la infraestructura base

```bash
cd devOps
cp .env.example .env     # completar con tus valores
docker compose up -d     # PostgreSQL + Redis + pgAdmin
```

### 4. Iniciar el primer change con OpenSpec

```bash
# Leer el scope del primer change antes de proponer:
# openspec/CHANGES.md → C-01 foundation-setup

/opsx:propose foundation-setup   # Genera proposal + design + tasks
/opsx:apply foundation-setup     # Implementa las tareas
/opsx:archive foundation-setup   # Archiva y marca [x] en CHANGES.md
```

---

## Rutas de navegación (knowledge-base)

| Necesito... | Leer |
|-------------|------|
| Entender el sistema | 01-negocio/01 → 01-negocio/02 → 02-arquitectura/01 |
| Planificar qué construir | 01-negocio/06 → 06-estado/07 → openspec/CHANGES.md |
| Implementar un feature | 05-dx/05 → 01-negocio/04 → 02-arquitectura/03 |
| Entender la arquitectura | 02-arquitectura/01 → 02-arquitectura/07 → 02-arquitectura/05 |
| Entender seguridad | 03-seguridad/01 → 03-seguridad/02 |
| Configurar entornos | 04-infraestructura/01 → 04-infraestructura/03 |
| Debugging | 05-dx/03 → 04-infraestructura/01 |

---

## Stack objetivo

| Capa | Tecnología |
|------|-----------|
| Backend | Python 3.12 + FastAPI + SQLAlchemy 2.0 + PostgreSQL 16 |
| WebSocket | Python + uvicorn + Redis 7 Streams |
| Dashboard | React 19 + TypeScript 5.9 + Zustand + Vite 7.2 |
| pwaMenu | React 19 + TypeScript + i18n (es/en/pt) + PWA |
| pwaWaiter | React 19 + TypeScript + Push Notifications |
| Infra | Docker Compose + Alembic + GitHub Actions CI |
