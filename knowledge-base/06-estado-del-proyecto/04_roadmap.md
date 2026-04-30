> ⚠️ **NOTA STARTER KIT**: Este roadmap describe el estado del sistema de **referencia** (jr2 original).
> Los ítems marcados `[x]` representan **decisiones ya tomadas** que DEBEN reimplementarse desde cero
> usando los changes en `openspec/CHANGES.md`. **No significan que el código ya existe en este repo.**
> Las fases del roadmap (0-5) describen el roadmap de producto — son distintas a las fases de construcción
> en CHANGES.md (FASE 0/1A/1B/1C/1D/2).

---

> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

# Roadmap y Oportunidades de Mejora

Plan de evolucion del sistema organizado en fases progresivas, con oportunidades de mejora categorizadas por impacto y esfuerzo.

---

## Principios del Roadmap

1. **Estabilidad antes que funcionalidad**: No tiene sentido agregar features sobre cimientos fragiles.
2. **Valor incremental**: Cada fase entrega valor independiente.
3. **Produccion como meta intermedia**: La Fase 2 es el umbral minimo para produccion confiable.
4. **Escalabilidad progresiva**: Escalar cuando los datos lo justifiquen, no antes.

---

## Fase 0: Cimientos (Inmediata)

> **Objetivo**: Bases minimas de ingenieria de software. Sin esto, todo lo que se construya esta en riesgo.

**Duracion estimada**: 1-2 semanas

### Tareas

- [x] **CI/CD con GitHub Actions** — COMPLETADO
  - `ci.yml` con 4 jobs paralelos (backend, Dashboard, pwaMenu, pwaWaiter): lint, type-check, test, build.
  - `docker-build.yml` para validacion de imagenes Docker.
  - *Pendiente*: Branch protection, notificaciones ante fallas, workflow de deploy.

- [x] **Inicializar Alembic correctamente** — COMPLETADO
  - 11 migraciones encadenadas (001 → 011). Configuracion funcional.
  - *Pendiente*: Migracion "initial schema" retroactiva, tests de upgrade/downgrade.

- [x] **Backups automatizados de base de datos** — COMPLETADO
  - `devOps/backup/backup.sh` con `pg_dump` + Redis AOF → .tar.gz.
  - Rotacion: 7 diarios, 4 semanales.
  - `devOps/backup/restore.sh` con restore interactivo + health check.
  - *Pendiente*: Storage externo (S3/GCS), monitoreo de ejecucion.

- [x] **Estandarizar VITE_API_URL** — COMPLETADO
  - Todos los frontends unificados a `localhost:8000` sin `/api`.

- [ ] **Eliminar JWT_SECRET de docker-compose**
  - Mover a `.env` no versionado. Referenciar `${JWT_SECRET}` sin default.
  - *Razon*: Cerrar vulnerabilidad de seguridad evidente.

- [ ] **Setup de framework E2E**
  - Playwright instalado con 3 specs basicos.
  - *Pendiente*: Al menos 1 test E2E del flujo critico completo (login → pedido → cocina).

---

## Fase 1: Completar el Core

> **Objetivo**: Implementar las funcionalidades que ya estan prometidas en la UI. El sistema debe hacer lo que dice que hace.

**Duracion estimada**: 4-6 semanas

### Tareas

- [x] **Kitchen Display Page (Dashboard)** — COMPLETADO
  - 3 columnas (En Espera / En Preparacion / Listos), colores de urgencia, timers auto-actualizados.
  - *Pendiente*: Tests dedicados, i18n, documentacion.

- [x] **Estadisticas basicas (Dashboard)** — COMPLETADO
  - `Sales.tsx` + `reports.py` con 4 endpoints (revenue diario, ordenes, ticket promedio, top productos, pedidos por hora).
  - *Pendiente*: Queries mas completos, mas tipos de graficos, tests.

- [ ] **Pagina de Exclusiones de Producto**
  - CRUD para exclusiones por producto (ingredientes que se pueden quitar).
  - Conexion con flujo de pedidos para personalizacion.

- [ ] **Producto no disponible (frontend)**
  - Backend existe y funciona. Falta UI en pwaMenu (badge "Agotado", boton deshabilitado) y Dashboard admin.

- [ ] **Customer Loyalty Fases 3-4**
  - Fase 3: Reconocimiento de cliente recurrente.
  - Fase 4: Opt-in con consentimiento GDPR.

---

## Fase 2: Produccion

> **Objetivo**: Sistema listo para un restaurante real con confianza en estabilidad y seguridad.

**Duracion estimada**: 3-4 semanas

### Tareas

- [ ] **TLS/HTTPS**
  - Let's Encrypt + Nginx reverse proxy + WSS + HSTS.

- [ ] **Agregacion y centralizacion de logs**
  - Opcion liviana: Grafana Loki + Promtail.
  - Todos los servicios con tenant_id, request_id, user_id como campos estructurados.
  - Alertas para errores criticos.

- [ ] **Dashboards de monitoreo**
  - Prometheus + Grafana.
  - Metricas: requests/s, latencia p95, conexiones WS, Redis memory, DB connections.
  - Alertas de umbral.

- [ ] **Load testing**
  - k6 o Locust. Escenarios: 50, 100, 200, 400 conexiones WS simultaneas.
  - Establecer baselines reales del sistema.

- [ ] **Estrategia de rotacion de secrets**
  - Soporte para multiples secrets activos durante ventana de rotacion.

- [ ] **Documentacion de despliegue en produccion**
  - Guia paso a paso, checklist de seguridad, runbook de operaciones.

---

## Fase 3: Escalabilidad

> **Objetivo**: Preparar para multiples sucursales, multiples restaurantes, mayor concurrencia.

**Duracion estimada**: 4-6 semanas

### Tareas

- [ ] **WS Gateway horizontal**
  - Multiples instancias detras de load balancer (config existente en `docker-compose.prod.yml`).
  - Redis Streams para propagar eventos entre instancias.
  - Graceful shutdown.

- [ ] **Read replicas para PostgreSQL**
  - Replica de lectura para queries de estadisticas y reportes.

- [ ] **Redis Sentinel o Cluster**
  - Config existente en `docker-compose.prod.yml`. Implementar en produccion.

- [ ] **CDN para assets estaticos**
  - Frontends + imagenes de productos via CDN.

- [ ] **Event catch-up completo**
  - Implementar en Dashboard y pwaMenu (pwaWaiter ya lo tiene).

---

## Fase 4: Mejoras de Producto

> **Objetivo**: Funcionalidades que aumenten valor para restaurantes y comensales.

**Duracion estimada**: Continua, features independientes

### Tareas

- [ ] **Completar Push Notifications**
  - Persistencia de subscripciones, triggers WS → push, preferencias por usuario.

- [ ] **Libreria de componentes compartida**
  - `@integrador/ui` + `@integrador/ws-client`. Setup con Turborepo.

- [ ] **Historial de pedidos para clientes**
  - Cross-session, "Repetir pedido" con un toque.

- [ ] **Priorizacion de pedidos en cocina**
  - Algoritmo por tiempo de espera, tamanio del pedido, tipo de producto.

- [ ] **Soporte para delivery/takeout**
  - Modelos existen (migracion 004). Falta router + service + frontend + integracion Kitchen.

- [ ] **Dashboard multilenguaje completo**
  - Adopcion de i18next en las 34 paginas.

- [ ] **Completar abstraccion de gateway de pago**
  - Refactor billing router para usar ABC. Segunda implementacion (Stripe).

- [ ] **Reservas**
  - Modelo existe (migracion 003). Falta router + service + frontend.

- [ ] **Completar AFIP Fiscal**
  - Integrar `pyafipws` + certificados reales.

---

## Fase 5: Inteligencia

> **Objetivo**: Aprovechar datos acumulados con IA y analitica avanzada.

**Duracion estimada**: Continua, experimental

### Tareas

- [ ] **Recomendaciones de menu con IA**
  - Infraestructura parcial existente (Ollama, pgvector). Falta integracion con flujo de usuario.

- [ ] **Prediccion de demanda**
  - Modelo predictivo basado en historico, dia de semana, clima.

- [ ] **Deteccion automatica de alergenos**
  - Inferir desde ingredientes/sub-ingredientes. Verificacion humana obligatoria.

- [ ] **Precios dinamicos sugeridos**
  - Analisis de elasticidad, sugerencias con aprobacion manual.

- [ ] **Analitica de comportamiento de clientes**
  - Segmentacion, cohortes, patrones cruzados.

---

## Resumen Visual

```
Fase 0 ─── Fase 1 ─── Fase 2 ───┬── Fase 3
(Cimientos) (Core)    (Produccion)│  (Escalabilidad)
  1-2 sem    4-6 sem    3-4 sem   │    4-6 sem
  [~70%]     [~40%]               │
                                  ├── Fase 4
                                  │  (Mejoras de Producto)
                                  │    Continua
                                  │
                                  └── Fase 5
                                     (Inteligencia)
                                       Continua
```

**Nota**: Fases 3, 4 y 5 pueden ejecutarse en paralelo despues de Fase 2. La Fase 2 es el gateway obligatorio hacia produccion.

---

## Criterios de Exito por Fase

| Fase | Criterio |
|------|----------|
| 0 | CI verde en cada PR. Backup diario verificado. JWT_SECRET fuera de docker-compose. |
| 1 | Todas las paginas placeholder reemplazadas. Producto no disponible funcional en pwaMenu. |
| 2 | Sistema operando con TLS, monitoreo, alertas y documentacion de operaciones. |
| 3 | WS Gateway con 2+ instancias. Load test verde para 500+ conexiones. |
| 4 | Al menos 3 features de Fase 4 en produccion. |
| 5 | Al menos 1 modelo de IA integrado y generando valor medible. |

---

## Oportunidades de Mejora por Categoria

### Arquitectura

| # | Oportunidad | Impacto | Esfuerzo |
|---|-------------|---------|----------|
| 1 | Cliente WebSocket compartido (`@integrador/ws-client`) | Alto | Medio |
| 2 | Libreria UI compartida (`@integrador/ui`) | Alto | Alto |
| 3 | Generacion automatica de tipos del API (OpenAPI → TypeScript) | Alto | Medio |
| 4 | Row-Level Security en PostgreSQL (defensa multi-tenant) | Medio | Medio |
| 5 | Event Sourcing para facturacion (audit trail inmutable) | Medio | Alto |

### Rendimiento

| # | Oportunidad | Impacto | Esfuerzo |
|---|-------------|---------|----------|
| 6 | Server-Sent Events para CRUD admin (mas simple que WS para unidireccional) | Medio | Bajo-Medio |
| 7 | Carga diferida de traducciones en pwaMenu (lazy load idiomas) | Alto | Bajo |
| 8 | Pipeline de optimizacion de imagenes (resize, WebP, CDN) | Alto | Medio |
| 9 | Cache Redis para menu publico (endpoint mas consultado) | Alto | Bajo-Medio |

### Experiencia de Desarrollo

| # | Oportunidad | Impacto | Esfuerzo |
|---|-------------|---------|----------|
| 10 | Tooling de monorepo (Turborepo/Nx) | Medio | Medio-Alto |
| 11 | Storybook para componentes | Bajo | Bajo-Medio |
| 12 | Portal estatico de documentacion de API | Alto | Bajo |

### Producto

| # | Oportunidad | Impacto | Esfuerzo |
|---|-------------|---------|----------|
| 13 | Sistema de reservas (modelo existe, falta implementacion) | Alto | Alto |
| 14 | Soporte takeout/delivery (modelos existen) | Alto | Alto |
| 15 | Optimizacion Kitchen Display (priorizacion inteligente) | Medio | Medio |
| 16 | Dashboard de analitica avanzado | Medio | Medio |
| 17 | Sistema de feedback post-comida (rating, NPS) | Medio | Bajo-Medio |

---

## Quick Wins (Alto impacto, Bajo esfuerzo)

| Oportunidad | Esfuerzo estimado |
|-------------|-------------------|
| Carga diferida de traducciones (#7) | ~1 dia |
| Cache Redis para menu publico (#9) | ~2-3 dias |
| Portal estatico de documentacion API (#12) | ~1 dia |
| JWT_SECRET fuera de docker-compose | ~30 minutos |

---

*Ultima actualizacion: Abril 2026*
