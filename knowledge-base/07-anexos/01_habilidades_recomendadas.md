> Creado: 2026-04-05 | Actualizado: 2026-04-05 | Estado: vigente

# Habilidades Recomendadas para Agentes IA

Analisis cruzado entre el stack del proyecto **Integrador** y el catalogo de [skills.sh](https://skills.sh). Define que skills de IA instalar para maximizar la calidad del codigo asistido, organizadas en 4 niveles de prioridad.

---

## Stack del Proyecto (Referencia Rapida)

| Capa | Tecnologias |
|------|-------------|
| **Frontend** | React 19.2, TypeScript 5.9, Vite 7.2, Zustand 5.0, Tailwind CSS 4.1 |
| **Backend** | FastAPI 0.115, SQLAlchemy 2.0, PostgreSQL 16, Redis 7, Alembic |
| **Testing** | Vitest 4.0 (unit), Playwright 1.50 (E2E), pytest 8.3 (backend) |
| **Infra** | Docker, GitHub Actions CI, nginx LB, Redis Sentinel |
| **Patrones** | Clean Architecture, Outbox Pattern, RBAC, Soft Delete, WebSocket Gateway |

> Para detalle completo de dependencias ver [02-arquitectura/05_dependencias.md](../02-arquitectura/05_dependencias.md). Para tooling disponible ver [05-dx/01_tooling_inventario.md](../05-dx/01_tooling_inventario.md).

---

## Tier 1 — Imprescindibles

Skills con impacto directo en la calidad del codigo. Atacan exactamente lo que este proyecto necesita.

### Testing y Verificacion

| Skill | Publisher | Installs | Justificacion |
|-------|-----------|----------|---------------|
| `vitest` | antfu/skills | 10.4K | **Vitest en los 3 frontends.** Patrones avanzados, mocking, coverage strategies |
| `playwright-best-practices` | currents-dev | 17.7K | **Playwright en `e2e/`.** Best practices para tests estables, selectores, paralelismo |
| `test-driven-development` | obra/superpowers | 37.1K | Workflow TDD estructurado. Con 3 frontends + backend, TDD evita regresiones en cascada |
| `verification-before-completion` | obra/superpowers | 28.7K | Verificacion antes de dar por terminado. Critico en billing, auth y WebSocket |
| `python-testing-patterns` | wshobson/agents | 10.7K | **pytest en backend.** Patrones para fixtures, async testing, mocking de DB/Redis |
| `webapp-testing` | anthropics/skills | 35.8K | Testing de web apps (oficial Anthropic). Cubre frontend + integracion |

### Code Quality y Review

| Skill | Publisher | Installs | Justificacion |
|-------|-----------|----------|---------------|
| `code-review-excellence` | wshobson/agents | 9.8K | Con 34 paginas en Dashboard y 3 PWAs, los code reviews tienen que ser sistematicos |
| `requesting-code-review` | obra/superpowers | 35.5K | Como pedir reviews efectivos. Complementa `code-review-excellence` |
| `receiving-code-review` | obra/superpowers | 28.5K | Como procesar feedback de reviews. Cierra el ciclo |
| `systematic-debugging` | obra/superpowers | 44.2K | Debugging metodico. Con WebSocket + Outbox + 4 servicios, necesitas metodo |

**Instalacion Tier 1:**
```bash
npx skills add antfu/skills:vitest
npx skills add currents-dev/playwright-best-practices
npx skills add obra/superpowers:test-driven-development
npx skills add obra/superpowers:verification-before-completion
npx skills add wshobson/agents:python-testing-patterns
npx skills add anthropics/skills:webapp-testing
npx skills add wshobson/agents:code-review-excellence
npx skills add obra/superpowers:requesting-code-review
npx skills add obra/superpowers:receiving-code-review
npx skills add obra/superpowers:systematic-debugging
```

---

## Tier 2 — Altamente Recomendadas

Fortalecen la arquitectura y la seguridad del sistema.

### Arquitectura y Backend

| Skill | Publisher | Installs | Justificacion |
|-------|-----------|----------|---------------|
| `fastapi-templates` | wshobson/agents | 9.6K | **FastAPI en backend.** Templates y patrones para routers, services, middleware |
| `postgresql-optimization` | github/awesome-copilot | 8.9K | **PostgreSQL 16 con pgvector.** Optimizacion de queries, indices, EXPLAIN ANALYZE |
| `postgresql-table-design` | wshobson/agents | 9.8K | Diseno de tablas. Con 11 migraciones y modelos multi-tenant, esto es oro |
| `api-design-principles` | wshobson/agents | 13.2K | Principios de diseno de API. Con ~40 endpoints, la consistencia es clave |
| `architecture-patterns` | wshobson/agents | 10.2K | Ya usamos Clean Architecture, esto refuerza y expande |
| `typescript-advanced-types` | wshobson/agents | 19.0K | **TypeScript 5.9 strict.** Tipos avanzados para stores, API responses, unions |

### Seguridad

| Skill | Publisher | Installs | Justificacion |
|-------|-----------|----------|---------------|
| `security-best-practices` | supercent-io | 14.1K | JWT, HMAC tokens, RBAC, billing. La seguridad no es opcional |
| `audit-website` | squirrelscan | 39.8K | Auditoria de seguridad web. 3 frontends publicos = 3 superficies de ataque |
| `better-auth-best-practices` | better-auth | 29.9K | Best practices de auth. Refresh tokens, table tokens y WebSocket auth |

**Instalacion Tier 2:**
```bash
npx skills add wshobson/agents:fastapi-templates
npx skills add github/awesome-copilot:postgresql-optimization
npx skills add wshobson/agents:postgresql-table-design
npx skills add wshobson/agents:api-design-principles
npx skills add wshobson/agents:architecture-patterns
npx skills add wshobson/agents:typescript-advanced-types
npx skills add supercent-io/skills-template:security-best-practices
npx skills add squirrelscan/audit-website
npx skills add better-auth/better-auth-best-practices
```

---

## Tier 3 — Recomendadas

Mejoran el workflow de desarrollo y la calidad del frontend.

### Frontend y UI

| Skill | Publisher | Installs | Justificacion |
|-------|-----------|----------|---------------|
| `tailwind-design-system` | wshobson/agents | 25.7K | **Tailwind CSS 4.1 en los 3 frontends.** Design system consistente |
| `web-accessibility` | supercent-io | 12.7K | 3 PWAs publico-facing. Accesibilidad no es lujo, es requisito |
| `responsive-design` | supercent-io | 11.2K | PWAs mobile-first. Responsive tiene que ser solido |
| `polish` | pbakaus/impeccable | 34.6K | Pulir UI. Para cuando la funcionalidad esta y necesitas el detalle fino |
| `harden` | pbakaus/impeccable | 32.4K | Hardening de UI para edge cases. Cart compartido y real-time tienen muchos |

### Workflow de Desarrollo

| Skill | Publisher | Installs | Justificacion |
|-------|-----------|----------|---------------|
| `writing-plans` | obra/superpowers | 43.1K | Planificacion estructurada. En un monorepo de este tamano, improvisar es suicidio |
| `executing-plans` | obra/superpowers | 35.1K | Ejecucion de planes. Complemento directo de `writing-plans` |
| `using-git-worktrees` | obra/superpowers | 26.8K | Git worktrees para trabajar en multiples features del monorepo en paralelo |
| `dispatching-parallel-agents` | obra/superpowers | 26.6K | Agentes en paralelo. Con 4 sub-proyectos, paralelizar es eficiencia pura |
| `git-commit` | github/awesome-copilot | 19.1K | Commits consistentes. Conventional commits en un proyecto con 34+ paginas |
| `multi-stage-dockerfile` | github/awesome-copilot | 9.0K | **Docker en uso.** Multi-stage builds para optimizar imagenes de produccion |

**Instalacion Tier 3:**
```bash
npx skills add wshobson/agents:tailwind-design-system
npx skills add supercent-io/skills-template:web-accessibility
npx skills add supercent-io/skills-template:responsive-design
npx skills add pbakaus/impeccable:polish
npx skills add pbakaus/impeccable:harden
npx skills add obra/superpowers:writing-plans
npx skills add obra/superpowers:executing-plans
npx skills add obra/superpowers:using-git-worktrees
npx skills add obra/superpowers:dispatching-parallel-agents
npx skills add github/awesome-copilot:git-commit
npx skills add github/awesome-copilot:multi-stage-dockerfile
```

---

## Tier 4 — Opcionales

Utiles segun el momento del proyecto. Instalar bajo demanda.

| Skill | Publisher | Installs | Cuando usarla |
|-------|-----------|----------|---------------|
| `e2e-testing-patterns` | wshobson/agents | 9.0K | Al expandir la suite de Playwright |
| `playwright-generate-test` | github/awesome-copilot | 8.7K | Para generar tests E2E automaticamente |
| `python-performance-optimization` | wshobson/agents | 13.1K | Al optimizar endpoints lentos |
| `performance-optimization` | supercent-io | 11.5K | Optimizacion general de performance |
| `api-documentation` | supercent-io | 11.7K | Al documentar la API publicamente |
| `database-schema-design` | supercent-io | 12.1K | Antes de crear nuevas migraciones |
| `refactor` | github/awesome-copilot | 11.3K | En ciclos de refactoring planificados |
| `code-refactoring` | supercent-io | 11.9K | Complemento de `refactor` |
| `deployment-automation` | supercent-io | 11.2K | Al automatizar el deploy a produccion |
| `brainstorming` | obra/superpowers | 79.9K | Para sesiones de diseno de features nuevas |

```bash
# Instalar segun necesidad
npx skills add wshobson/agents:e2e-testing-patterns
npx skills add github/awesome-copilot:playwright-generate-test
npx skills add wshobson/agents:python-performance-optimization
npx skills add supercent-io/skills-template:performance-optimization
npx skills add supercent-io/skills-template:api-documentation
npx skills add supercent-io/skills-template:database-schema-design
npx skills add github/awesome-copilot:refactor
npx skills add supercent-io/skills-template:code-refactoring
npx skills add supercent-io/skills-template:deployment-automation
npx skills add obra/superpowers:brainstorming
```

---

## Skills Descartadas

Skills evaluadas y descartadas por no aplicar al stack o dominio del proyecto.

| Skill | Razon de descarte |
|-------|-------------------|
| Azure / AWS skills | No se usan cloud providers managed. Docker local + VPS |
| Next.js / Nuxt / Vue skills | Stack es React puro con Vite, no frameworks SSR |
| React Native / Expo | No hay apps nativas. Son PWAs web |
| Shadcn UI | No se usa Shadcn. UI es custom con Tailwind |
| Supabase / Convex / Neon | PostgreSQL directo con SQLAlchemy |
| Marketing / SEO skills | Sistema de gestion, no marketing |
| AI image/video generation | No aplica al dominio |
| Google Workspace / Lark | Sin integracion con productivity suites |
| Vercel deploy | Deploy con Docker + nginx, no Vercel |
| Node.js backend patterns | Backend es Python (FastAPI), no Node |

---

## Resumen Ejecutivo

| Tier | Cantidad | Foco |
|------|----------|------|
| **Tier 1** — Imprescindibles | 10 skills | Testing + Code Review + Debugging |
| **Tier 2** — Altamente Recomendadas | 9 skills | Arquitectura + DB + Seguridad |
| **Tier 3** — Recomendadas | 11 skills | Frontend + Workflow |
| **Tier 4** — Opcionales | 10 skills | Herramientas puntuales |
| **Total recomendadas** | **40 skills** | 10% del catalogo de skills.sh |

### Script de instalacion rapida (Tier 1 + Tier 2)

```bash
# Tier 1 — Imprescindibles
npx skills add antfu/skills:vitest
npx skills add currents-dev/playwright-best-practices
npx skills add obra/superpowers:test-driven-development
npx skills add obra/superpowers:verification-before-completion
npx skills add wshobson/agents:python-testing-patterns
npx skills add anthropics/skills:webapp-testing
npx skills add wshobson/agents:code-review-excellence
npx skills add obra/superpowers:requesting-code-review
npx skills add obra/superpowers:receiving-code-review
npx skills add obra/superpowers:systematic-debugging

# Tier 2 — Altamente Recomendadas
npx skills add wshobson/agents:fastapi-templates
npx skills add github/awesome-copilot:postgresql-optimization
npx skills add wshobson/agents:postgresql-table-design
npx skills add wshobson/agents:api-design-principles
npx skills add wshobson/agents:architecture-patterns
npx skills add wshobson/agents:typescript-advanced-types
npx skills add supercent-io/skills-template:security-best-practices
npx skills add squirrelscan/audit-website
npx skills add better-auth/better-auth-best-practices
```

---

## Referencias

- [02-arquitectura/05_dependencias.md](../02-arquitectura/05_dependencias.md) — Stack completo con versiones y proposito de cada dependencia
- [06-estado-del-proyecto/03_salud_tecnica.md](../06-estado-del-proyecto/03_salud_tecnica.md) — Deuda tecnica que estas skills ayudan a mitigar
- [05-dx/02_onboarding_developer.md](../05-dx/02_onboarding_developer.md) — Guia de onboarding donde estas skills aceleran la curva
- [05-dx/01_tooling_inventario.md](../05-dx/01_tooling_inventario.md) — Herramientas de desarrollo existentes en el proyecto
- [06-estado-del-proyecto/04_roadmap.md](../06-estado-del-proyecto/04_roadmap.md) — Mejoras que las skills de Tier 2-3 habilitan
