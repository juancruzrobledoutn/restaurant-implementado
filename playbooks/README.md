# Playbooks Multi-Agente — Integrador

> Prompts listos para orquestar múltiples agentes en paralelo sobre el monorepo.

## Cómo usar

1. Elegí el playbook que corresponde a tu tarea
2. Copiá el prompt completo
3. Reemplazá las variables `{{VAR}}` con tus valores
4. Pegalo en Claude Code

## Playbooks disponibles

| # | Playbook | Cuándo usar | Agentes | Ahorro |
|---|----------|-------------|---------|--------|
| 1 | [Nuevo Módulo CRUD](./01-nuevo-modulo.md) | Feature completa end-to-end | 3 | ~75% |
| 2 | [Bug Fix Cross-Capa](./02-bug-fix.md) | Bug que toca backend + frontend | 2 | ~75% |
| 3 | [Auditoría Semanal](./03-audit.md) | Review periódico de calidad | 4 | ~80% |
| 4 | [Release Prep](./04-release.md) | Antes de un deploy | 3 | ~70% |
| 5 | [Refactor Coordinado](./05-refactor.md) | Cambio atómico en múltiples capas | 2-5 | ~70% |

## Convenciones

Todos los playbooks asumen:
- **Engram activo**: guarda decisiones con `mem_save`, consulta con `mem_search`
- **Knowledge base v4**: carpetas en `knowledge-base/` como contexto
- **CLAUDE.md**: guía principal del proyecto
- **knowledge-base/01-negocio/04_reglas_de_negocio.md**: reglas de negocio canonical
