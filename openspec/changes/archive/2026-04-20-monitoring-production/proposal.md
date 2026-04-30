## Why

El sistema completa su ciclo funcional con C-22 (E2E) pero carece de las tres piezas que lo hacen operable en producción: TLS (obligatorio para cookies HttpOnly seguras y MercadoPago webhooks), visibilidad de lo que ocurre en runtime (logs y métricas), y un runbook que guíe la operación ante fallos. Sin esto, el despliegue es técnicamente inseguro e inoperable.

## What Changes

- **TLS/SSL**: `devOps/nginx/nginx-ssl.conf` con terminación SSL en nginx + `devOps/ssl/init-letsencrypt.sh` para provisioning automático de certificados Let's Encrypt via Certbot (renovación automática cada 12h en cronjob Docker).
- **Log aggregation**: Grafana Loki + Promtail agregados al `docker-compose.prod.yml`. Todos los servicios (backend, ws_gateway) emiten logs estructurados JSON con campos `tenant_id`, `request_id`, `user_id`, `level`. Promtail scraping de archivos de log + Docker labels.
- **Métricas y dashboards**: Prometheus scraping de métricas de todos los servicios + Grafana con dashboards precargados vía provisioning. Métricas cubiertas: requests/s, latencia p95/p99, conexiones WebSocket activas, memoria Redis, conexiones PostgreSQL, errores 4xx/5xx.
- **Alerting**: Alertmanager con reglas para errores críticos (500 rate > 1%), rate limit excedido (429 spike), Redis down, PostgreSQL down, WS latencia > 500ms.
- **RUNBOOK.md**: `devOps/RUNBOOK.md` con checklist de despliegue a producción, playbooks de incidentes frecuentes y procedimientos de rollback.

## Capabilities

### New Capabilities

- `tls-ssl`: Terminación TLS en nginx con Let's Encrypt. Incluye nginx-ssl.conf, init-letsencrypt.sh, renovación automática y redirección HTTP→HTTPS.
- `log-aggregation`: Stack Loki + Promtail para agregación centralizada de logs con campos de contexto multi-tenant (tenant_id, request_id, user_id).
- `metrics-monitoring`: Stack Prometheus + Grafana + Alertmanager. Dashboards precargados, reglas de alertas para condiciones críticas de producción.
- `production-runbook`: RUNBOOK.md operativo con checklist de deploy, playbooks de incidentes y procedimientos de recuperación.

### Modified Capabilities

- `docker-infrastructure`: Agrega servicios Loki, Promtail, Prometheus, Grafana y Alertmanager al compose de producción. Agrega nginx como servicio con TLS.
- `security-middleware`: Los logs estructurados del backend deben incluir `request_id` (UUID por request) y `user_id` (del JWT si autenticado) en cada línea de log.

## Impact

- **devOps/**: `nginx/nginx-ssl.conf`, `ssl/init-letsencrypt.sh`, `monitoring/prometheus.yml`, `monitoring/alertmanager.yml`, `monitoring/grafana/provisioning/`, `docker-compose.prod.yml` (servicios nuevos), `RUNBOOK.md`
- **backend/**: Middleware de `request_id` inyectado en cada request, propagado al logger. Sin cambios en lógica de negocio.
- **ws_gateway/**: Structured logging con los mismos campos que el backend.
- **Dependencias nuevas**: `grafana/grafana`, `prom/prometheus`, `grafana/loki`, `grafana/promtail`, `prom/alertmanager`, `nginx` (ya en prod), `certbot/certbot`
- **Variables de entorno nuevas**: `DOMAIN`, `CERTBOT_EMAIL`, `GRAFANA_ADMIN_PASSWORD`
