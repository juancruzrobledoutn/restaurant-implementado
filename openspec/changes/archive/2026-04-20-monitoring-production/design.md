## Context

El sistema Integrador / Buen Sabor completó su ciclo funcional completo (C-01 a C-22). El estado actual de producción según `knowledge-base/04-infraestructura/03_despliegue.md` es:

- TLS/SSL: **No configurado** — bloqueante para cookies HttpOnly seguras y webhooks MercadoPago (requieren HTTPS)
- Log Aggregation: **No implementado** — no hay forma de correlacionar eventos entre backend y ws_gateway en producción
- Monitoreo APM: **Parcial** — solo web-vitals en frontend, sin visibilidad de backend en runtime
- CDN: No configurado (fuera de scope de este change)

El stack productivo usa Docker Compose con overlay (`docker-compose.prod.yml`). nginx ya está configurado como load balancer. Todos los servicios tienen health checks.

## Goals / Non-Goals

**Goals:**
- TLS automático con Let's Encrypt y renovación sin intervención manual
- Logs estructurados JSON en backend y ws_gateway, centralizados en Loki, consultables desde Grafana
- Métricas de infraestructura y aplicación en Prometheus, dashboards precargados en Grafana
- Alertas operacionales para condiciones críticas (errores, servicios caídos, latencia)
- RUNBOOK.md con procedimientos operacionales completos

**Non-Goals:**
- Distributed tracing (OpenTelemetry) — overhead de adopción no justificado en esta etapa
- CDN para assets estáticos — los frontends sirven desde nginx en primera instancia
- Redis Sentinel upgrade — ya está configurado en `docker-compose.prod.yml`
- Database connection pooling (PgBouncer) — no hay evidencia de contención en este volumen
- Logs de frontend (browser) — alcanza con error rates desde el backend

## Decisions

### D1: Loki en lugar de ELK (Elasticsearch + Logstash + Kibana)

**Decisión**: Grafana Loki + Promtail.

**Alternativa**: ELK stack (usado en industria, más maduro).

**Rationale**: ELK requiere 4-8 GB de RAM mínimo en producción (Elasticsearch es JVM-heavy). Loki consume 10x menos recursos, indexa solo metadatos (labels) y guarda el texto completo en objeto/disco. Como ya usamos Grafana para dashboards de métricas, tener logs y métricas en la misma interfaz elimina el cambio de contexto. Para el volumen de un restaurante SaaS inicial, Loki es más que suficiente.

### D2: Let's Encrypt con Certbot en Docker + renovación automática

**Decisión**: Certbot como servicio Docker en `docker-compose.prod.yml`, con nginx sirviendo `.well-known/acme-challenge/` en HTTP (puerto 80) para el challenge, y un cronjob Docker que ejecuta `certbot renew` cada 12 horas.

**Alternativa**: Traefik como reverse proxy con ACME integrado.

**Rationale**: nginx ya está en el stack productivo y el equipo lo conoce. Agregar Traefik implicaría reemplazar nginx (cambio de blast radius alto) o correr ambos en cascada (innecesariamente complejo). Certbot + nginx es el patrón más documentado y probado para Let's Encrypt.

**Staging**: Para desarrollo/CI donde no hay dominio público, se usa `nginx-selfsigned.conf` con certificado self-signed (incluido en el change para facilitar el testing local de la configuración HTTPS).

### D3: Prometheus pull model + Alertmanager standalone

**Decisión**: Prometheus scraping de métricas con endpoints `/metrics` en cada servicio (FastAPI expone via `prometheus-fastapi-instrumentator`). Alertmanager standalone conectado a Prometheus para enrutamiento de alertas.

**Alternativa**: Push model con Graphite/StatsD.

**Rationale**: El pull model de Prometheus es más simple de operar (sin agentes de push), más fácil de debuggear (se puede hacer curl al endpoint `/metrics` de cualquier servicio), y Prometheus es el estándar de facto del ecosistema Docker/Kubernetes.

**Notificaciones de alertas**: Alertmanager configurado con webhook genérico. Slack/PagerDuty se configura via variable de entorno `ALERTMANAGER_WEBHOOK_URL` (sin hardcodear en archivos del repo).

### D4: request_id como UUID4 por request (middleware FastAPI)

**Decisión**: Middleware FastAPI en backend y ws_gateway que genera `request_id = uuid4()` al inicio de cada request, lo propaga en el contexto del logger (via `contextvars`), y lo incluye como header de respuesta `X-Request-ID`.

**Alternativa**: OpenTelemetry trace IDs.

**Rationale**: `request_id` simple es suficiente para correlacionar logs de un mismo request sin el overhead de instrumentar toda la cadena con OTEL. En Loki se puede filtrar por `{request_id="abc-123"}` para ver el ciclo completo de un request. Si en el futuro se adopta OTEL, el middleware se puede extender para generar trace IDs compatibles.

### D5: Grafana dashboards como JSON en provisioning (code-first)

**Decisión**: Los dashboards de Grafana se definen como archivos JSON en `devOps/monitoring/grafana/provisioning/dashboards/`. Grafana los carga automáticamente al iniciar via provisioning.

**Rationale**: Los dashboards en la UI de Grafana se pierden si el volumen se borra. Con provisioning, los dashboards son reproducibles desde cero con `docker compose up`. Los archivos JSON van al repo y cualquier cambio es revisable en code review.

## Risks / Trade-offs

- **Let's Encrypt requiere dominio público** → Para testing local de TLS, se provee `nginx-selfsigned.conf` con certificado self-signed. Para staging sin dominio, se puede usar `--staging` flag de Certbot (límites más laxos).

- **Volúmenes de Loki pueden crecer indefinidamente** → Retención configurada en `loki.yml` a 30 días por defecto. Configurable via variable `LOKI_RETENTION_PERIOD`.

- **Grafana admin password en variable de entorno** → `GRAFANA_ADMIN_PASSWORD` debe estar en `.env` de producción. El `.env.example` lo incluye como placeholder. Si el secreto rota, requiere `docker compose restart grafana`.

- **`prometheus-fastapi-instrumentator` agrega latencia mínima** → El overhead es < 1ms por request en benchmarks del autor. Aceptable para este caso de uso.

- **Alertmanager webhook sin retry persistente** → Si el destino de alertas (Slack/PagerDuty) está caído, las alertas se pierden. Mitigación: el dashboard de Grafana sigue mostrando el estado de las métricas aunque las notificaciones fallen.

## Migration Plan

Despliegue secuencial en producción:

1. **Fase 1 — TLS** (zero-downtime):
   - Hacer DNS apuntar al servidor de producción si no está hecho
   - Agregar `DOMAIN` y `CERTBOT_EMAIL` al `.env` de producción
   - Levantar Certbot: `docker compose up certbot` → obtiene certificados en `devOps/ssl/certbot/`
   - Actualizar nginx: `docker compose up -d nginx` (ahora con `nginx-ssl.conf`)
   - Verificar HTTPS en todas las URLs

2. **Fase 2 — Monitoring stack**:
   - Agregar `GRAFANA_ADMIN_PASSWORD` al `.env`
   - `docker compose up -d prometheus grafana loki promtail alertmanager`
   - Verificar dashboards en `https://<domain>:3000` (o puerto configurable)
   - Configurar `ALERTMANAGER_WEBHOOK_URL` para notificaciones

3. **Fase 3 — Backend logging middleware**:
   - Deploy del backend con el nuevo middleware `request_id`
   - Verificar en Loki que los logs aparecen con labels `tenant_id`, `request_id`, `user_id`
   - Activar alertas en Alertmanager

**Rollback**: Los cambios de monitoring son aditivos (nuevos servicios Docker). Revertir es `docker compose stop prometheus grafana loki promtail alertmanager`. El middleware `request_id` es un log-only change (no afecta comportamiento de la app) — se puede revertir con deploy del backend sin el middleware.

## Open Questions

- ¿El dominio de producción final es `buensabor.com` o un subdominio? → Define el `DOMAIN` en `.env`. El nginx-ssl.conf usa `${DOMAIN}` como variable de entorno leída via `envsubst`.
- ¿Las alertas van a Slack o email? → Configurable en `alertmanager.yml` via `ALERTMANAGER_WEBHOOK_URL`. No bloquea la implementación.
- ¿Grafana debe estar expuesto públicamente o solo internamente? → Por defecto, solo accesible desde la red interna del servidor (no expuesto en nginx). Se puede abrir un virtual host nginx para acceso externo si se necesita.
