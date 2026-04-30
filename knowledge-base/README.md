# Knowledge Base — Integrador / Buen Sabor

> Índice de navegación. Cada carpeta agrupa documentos por dominio.

**Actualizada:** 2026-04-08 | **Versión:** v5 | **Documentos:** 39 | **Carpetas:** 7

---

## 01-negocio/ — Dominio y Reglas

| Documento | Contenido |
|-----------|-----------|
| [01_vision_y_contexto.md](01-negocio/01_vision_y_contexto.md) | Visión del sistema, problema que resuelve, propuesta de valor, stack |
| [02_actores_y_roles.md](01-negocio/02_actores_y_roles.md) | RBAC, 6 actores, métodos de auth, usuarios de prueba |
| [03_funcionalidades.md](01-negocio/03_funcionalidades.md) | Features por componente con estado de madurez |
| [04_reglas_de_negocio.md](01-negocio/04_reglas_de_negocio.md) | Reglas + máquinas de estado (sessions, rounds, billing, allergens) |
| [05_flujos_y_casos_de_uso.md](01-negocio/05_flujos_y_casos_de_uso.md) | Flujos narrativos + casos de uso formales por actor |
| [06_backlog_completo.md](01-negocio/06_backlog_completo.md) | Backlog completo: 20 épicas, 100+ historias con criterios de aceptación y plan de sprints |

## 02-arquitectura/ — Diseño Técnico

| Documento | Contenido |
|-----------|-----------|
| [01_arquitectura_general.md](02-arquitectura/01_arquitectura_general.md) | Clean Architecture, capas, 15 componentes clave, infra |
| [02_modelo_de_datos.md](02-arquitectura/02_modelo_de_datos.md) | 18+ tablas, relaciones, convenciones de datos |
| [03_api_y_endpoints.md](02-arquitectura/03_api_y_endpoints.md) | REST completo, WebSocket endpoints, auth por ruta |
| [04_eventos_y_websocket.md](02-arquitectura/04_eventos_y_websocket.md) | Eventos, routing matrix, Outbox vs Redis, flujos de datos |
| [05_patrones_de_diseno.md](02-arquitectura/05_patrones_de_diseno.md) | 57 patrones, gap analysis planificado vs implementado |
| [06_capas_de_abstraccion.md](02-arquitectura/06_capas_de_abstraccion.md) | 8 puntos de extensión con código de ejemplo |
| [07_decisiones_y_tradeoffs.md](02-arquitectura/07_decisiones_y_tradeoffs.md) | 23 ADRs agrupados por dominio + matriz de riesgo |

## 03-seguridad/ — Modelo de Seguridad

| Documento | Contenido |
|-----------|-----------|
| [01_modelo_de_seguridad.md](03-seguridad/01_modelo_de_seguridad.md) | JWT, Table Tokens, RBAC, rate limiting, SSRF/XSS/CSRF |
| [02_superficie_de_ataque.md](03-seguridad/02_superficie_de_ataque.md) | 161 endpoints, headers, inputs, gaps identificados |

## 04-infraestructura/ — Deploy, Config, Ops

| Documento | Contenido |
|-----------|-----------|
| [01_configuracion_y_entornos.md](04-infraestructura/01_configuracion_y_entornos.md) | Variables .env por componente, diferencias dev/prod |
| [02_dependencias.md](04-infraestructura/02_dependencias.md) | Stack completo con versiones, justificaciones, EOL |
| [03_despliegue.md](04-infraestructura/03_despliegue.md) | Docker Compose, producción escalada, CI/CD, troubleshooting |
| [04_migraciones.md](04-infraestructura/04_migraciones.md) | Cadena Alembic 001-011, comandos, workflow |
| [05_integraciones.md](04-infraestructura/05_integraciones.md) | 7 integraciones externas (MercadoPago, Redis, PG, Ollama...) |

## 05-dx/ — Developer Experience

| Documento | Contenido |
|-----------|-----------|
| [01_onboarding.md](05-dx/01_onboarding.md) | Setup rápido, prerrequisitos, troubleshooting inicial |
| [02_tooling.md](05-dx/02_tooling.md) | Inventario de herramientas (Docker, CLI, testing, CI) |
| [03_trampas_conocidas.md](05-dx/03_trampas_conocidas.md) | Gotchas: config, Windows, Zustand, SQLAlchemy, security |
| [04_convenciones_y_estandares.md](05-dx/04_convenciones_y_estandares.md) | **NUEVO** — Naming, DB, frontend, backend, API, UI, i18n |
| [05_workflow_implementacion.md](05-dx/05_workflow_implementacion.md) | **NUEVO** — Guía end-to-end: modelo → migración → servicio → frontend → test |
| [06_estrategia_testing.md](05-dx/06_estrategia_testing.md) | **NUEVO** — Filosofía, pytest, Vitest, E2E, CI, coverage |
| [07_internacionalizacion.md](05-dx/07_internacionalizacion.md) | Estado i18n por componente (pwaMenu 100%, Dashboard scaffold) |

## 06-estado-del-proyecto/ — Estado Actual y Futuro

| Documento | Contenido |
|-----------|-----------|
| [01_metricas.md](06-estado-del-proyecto/01_metricas.md) | 649 archivos, 130K LOC, métricas por componente |
| [02_madurez_y_dependencias.md](06-estado-del-proyecto/02_madurez_y_dependencias.md) | Matriz de madurez (52 features), dependencias, priorización |
| [03_salud_tecnica.md](06-estado-del-proyecto/03_salud_tecnica.md) | Limitaciones + deuda técnica + riesgos (depurado) |
| [04_roadmap.md](06-estado-del-proyecto/04_roadmap.md) | Fases 0-5, oportunidades de mejora, quick wins |
| [05_preguntas_y_suposiciones.md](06-estado-del-proyecto/05_preguntas_y_suposiciones.md) | Suposiciones validadas/pendientes, preguntas abiertas |
| [06_inconsistencias.md](06-estado-del-proyecto/06_inconsistencias.md) | Registro histórico (todas resueltas a 2026-04-05) |
| [07_backlog_pendiente.md](06-estado-del-proyecto/07_backlog_pendiente.md) | Backlog gap-focused: historias pendientes priorizadas por valor operativo y dependencias técnicas |

## 07-anexos/

| Documento | Contenido |
|-----------|-----------|
| [01_habilidades_recomendadas.md](07-anexos/01_habilidades_recomendadas.md) | 40 skills recomendadas para IA, organizadas por tier |
| [02_estructura_del_codigo.md](07-anexos/02_estructura_del_codigo.md) | File trees completos del monorepo |
| [03_estandar_calidad_clean_architecture.md](07-anexos/03_estandar_calidad_clean_architecture.md) | Estándar de calidad objetivo: Clean Architecture (benchmark para el nuevo desarrollo) |
| [04_estandar_calidad_fastapi.md](07-anexos/04_estandar_calidad_fastapi.md) | Estándar de calidad objetivo: FastAPI (routes, dependencies, validation, async) |
| [05_estandar_calidad_pwa.md](07-anexos/05_estandar_calidad_pwa.md) | Estándar de calidad objetivo: PWA pwaMenu y pwaWaiter |
| [06_estandar_calidad_websocket.md](07-anexos/06_estandar_calidad_websocket.md) | Estándar de calidad objetivo: WebSocket Gateway |
| [07_estandar_calidad_gateway.md](07-anexos/07_estandar_calidad_gateway.md) | Estándar de calidad objetivo: Socket Gateway patterns |
| [08_seed_data_minimo.md](07-anexos/08_seed_data_minimo.md) | Especificación exacta del seed data para C-02 (tenant, branch, 4 usuarios) |

---

## Rutas de Navegación

| Necesito... | Leer |
|-------------|------|
| Entender el sistema | 01-negocio/01 → 01-negocio/02 → 02-arquitectura/01 |
| Hacer onboarding | 05-dx/01 → 05-dx/04 → 05-dx/05 |
| Implementar un feature | 05-dx/05 → 01-negocio/04 → 02-arquitectura/03 |
| Entender seguridad | 03-seguridad/01 → 03-seguridad/02 |
| Evaluar estado del proyecto | 06-estado/01 → 06-estado/02 → 06-estado/03 |
| Debugging | 05-dx/03 → 04-infraestructura/01 |
| Decisiones de arquitectura | 02-arquitectura/07 → 02-arquitectura/05 |
| Deploy a producción | 04-infraestructura/03 → 04-infraestructura/04 |
| Planificar qué construir | 01-negocio/06 → 06-estado/07 → 06-estado/04 |
