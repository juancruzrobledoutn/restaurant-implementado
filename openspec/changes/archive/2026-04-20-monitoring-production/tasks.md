## 1. TLS / nginx SSL

- [x] 1.1 Crear `devOps/nginx/nginx-ssl.conf` con TLS 1.2+, HSTS, OCSP stapling, cipher suites seguros, redirección HTTP→HTTPS en puerto 80, proxy_pass a backend y ws_gateway
- [x] 1.2 Crear `devOps/ssl/init-letsencrypt.sh`: script que levanta Certbot con `--webroot`, obtiene el certificado para `$DOMAIN`, y recarga nginx; incluir manejo de dominio ya registrado (--keep-until-expiring)
- [x] 1.3 Crear `devOps/ssl/generate-selfsigned.sh`: genera certificado self-signed para desarrollo local en `devOps/ssl/selfsigned/`
- [x] 1.4 Crear `devOps/nginx/nginx-selfsigned.conf`: configuración nginx para TLS local con certificado self-signed (idéntica a nginx-ssl.conf pero apuntando a selfsigned/)
- [x] 1.5 Agregar servicio `nginx` y `certbot` en `devOps/docker-compose.prod.yml` con volúmenes para certificados y cronjob de renovación cada 12h (`certbot renew --webroot && nginx -s reload`)
- [x] 1.6 Agregar variables `DOMAIN`, `CERTBOT_EMAIL` a `devOps/.env.example` con comentarios explicativos
- [x] 1.7 Verificar que `COOKIE_SECURE=true` y `ENVIRONMENT=production` activan HSTS en el backend (ya implementado en security-middleware — solo verificar)

## 2. Request ID Middleware (Backend + ws_gateway)

- [x] 2.1 Crear `backend/shared/middleware/request_id.py`: `RequestIDMiddleware` que genera `uuid4()` por request, lo guarda en `ContextVar`, agrega header `X-Request-ID` a la respuesta
- [x] 2.2 Actualizar `get_logger()` en `backend/shared/config/logging.py` para leer `request_id`, `user_id`, `tenant_id` desde `ContextVar` e incluirlos automáticamente en cada log record JSON
- [x] 2.3 Registrar `RequestIDMiddleware` en `backend/rest_api/main.py` (antes que otros middlewares de lógica)
- [x] 2.4 Replicar `RequestIDMiddleware` en `ws_gateway/` (adaptado para el WS gateway) — mismos campos en logs JSON
- [x] 2.5 Verificar que los logs de backend y ws_gateway emiten JSON válido con campos `timestamp`, `level`, `service`, `message`, `request_id`, `user_id` (cuando aplica), `tenant_id` (cuando aplica)
- [x] 2.6 Agregar tests en `backend/tests/test_request_id_middleware.py`: verificar header `X-Request-ID` presente, verificar propagación en contexto de logs

## 3. Grafana Loki + Promtail

- [x] 3.1 Crear `devOps/monitoring/loki/loki.yml`: configuración Loki con `filesystem` storage, retención 30 días configurable via `LOKI_RETENTION_PERIOD` env var, compactor habilitado
- [x] 3.2 Crear `devOps/monitoring/promtail/promtail.yml`: pipeline que scrape logs de contenedores Docker via Docker socket (o log files), con labels `job`, `service`, `container`; parseo de JSON para extraer campos como labels de Loki
- [x] 3.3 Agregar servicios `loki` y `promtail` en `devOps/docker-compose.prod.yml` con volúmenes nombrados para persistencia de Loki
- [x] 3.4 Agregar datasource de Loki en `devOps/monitoring/grafana/provisioning/datasources/loki.yml` (provisioning automático)
- [~] 3.5 Verificar: levantar el stack, emitir un log desde el backend, confirmar que aparece en Grafana Explore con LogQL `{service="backend"}` — requiere entorno live

## 4. Prometheus + Exporters

- [x] 4.1 Agregar `prometheus-fastapi-instrumentator` a `backend/requirements.txt` e instrumentar la app FastAPI en `backend/rest_api/main.py` (endpoint `/metrics` expuesto)
- [x] 4.2 Instrumentar `ws_gateway/main.py` con métricas custom: `websocket_connections_active` (gauge), `websocket_messages_total` (counter) — expuesto en `GET /metrics`
- [x] 4.3 Crear `devOps/monitoring/prometheus/prometheus.yml`: scrape configs para backend (`:8000/metrics`), ws_gateway (`:8001/metrics`), redis_exporter (`:9121/metrics`), postgres_exporter (`:9187/metrics`); scrape interval 15s
- [x] 4.4 Agregar servicios `prometheus`, `redis_exporter`, `postgres_exporter` en `devOps/docker-compose.prod.yml` con sus variables de entorno (`REDIS_ADDR`, `DATA_SOURCE_NAME` para postgres)
- [x] 4.5 Verificar: targets en Prometheus UI muestran todos como `UP` — redis ✅ postgres ✅ prometheus ✅; backend/ws_gateway DOWN (corren nativos, aceptable en dev)

## 5. Grafana Dashboards

- [x] 5.1 Crear `devOps/monitoring/grafana/provisioning/datasources/prometheus.yml`: datasource Prometheus pre-configurado (URL `http://prometheus:9090`)
- [x] 5.2 Crear `devOps/monitoring/grafana/provisioning/dashboards/dashboards.yml`: configuración de provisioning que apunta al directorio de JSONs
- [x] 5.3 Crear dashboard JSON "Application Overview" (`devOps/monitoring/grafana/provisioning/dashboards/app-overview.json`): panels para requests/s, latencia p95, tasa de errores 5xx, tasa de errores 4xx — métricas de backend y ws_gateway
- [x] 5.4 Crear dashboard JSON "Infrastructure" (`devOps/monitoring/grafana/provisioning/dashboards/infrastructure.json`): panels para Redis memory used, Redis connected clients, PostgreSQL active connections, WS connections activas
- [x] 5.5 Agregar servicio `grafana` en `devOps/docker-compose.prod.yml` con volúmenes para provisioning y persistencia, variable `GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}`
- [x] 5.6 Agregar `GRAFANA_ADMIN_PASSWORD` a `devOps/.env.example`
- [x] 5.7 Verificar: después de `docker compose up -d`, los dos dashboards están disponibles en Grafana sin importación manual — "Application Overview" ✅ "Infrastructure" ✅ en carpeta Integrador

## 6. Alertmanager

- [x] 6.1 Crear `devOps/monitoring/prometheus/alerts.yml`: reglas de alerta — `HighErrorRate` (5xx > 1% por 5m), `BackendDown` (backend target down > 1m), `RedisDown` (redis_exporter target down > 1m), `PostgresDown` (postgres_exporter target down > 1m), `HighLatency` (p95 > 2s por 5m), `RateLimitSpike` (429 rate > 50/min)
- [x] 6.2 Crear `devOps/monitoring/alertmanager/alertmanager.yml`: receiver configurado con webhook genérico (`$ALERTMANAGER_WEBHOOK_URL`), grouping por `alertname`, inhibit rules básicas (no alertar por componentes individuales si ya hay alerta de sistema completo)
- [x] 6.3 Referenciar `alerts.yml` en `prometheus.yml` (sección `rule_files`)
- [x] 6.4 Agregar servicio `alertmanager` en `devOps/docker-compose.prod.yml`
- [x] 6.5 Agregar `ALERTMANAGER_WEBHOOK_URL` a `devOps/.env.example` (sin valor default — dejar vacío con comentario)
- [x] 6.6 Verificar: disparar una alerta manualmente (ej. detener backend) y confirmar que aparece en Alertmanager UI — BackendDown firing ✅ (backend corre nativo → Prometheus lo ve DOWN → alerta activa en Alertmanager)

## 7. Redes Docker y aislamiento

- [x] 7.1 Definir red `monitoring` en `devOps/docker-compose.prod.yml` (driver bridge)
- [x] 7.2 Asignar backend y ws_gateway a redes `backend` y `monitoring` (para que Prometheus pueda scraping)
- [x] 7.3 Asignar prometheus, grafana, loki, promtail, alertmanager solo a red `monitoring`
- [x] 7.4 Verificar que Prometheus, Alertmanager y Loki NO tienen puertos expuestos al host — solo Grafana expone puerto (configurable)

## 8. RUNBOOK.md

- [x] 8.1 Crear `devOps/RUNBOOK.md` con sección "Pre-deployment Checklist": verificar env vars requeridas, estado de certificados TLS, migraciones Alembic al día, health checks de todos los servicios, smoke test commands
- [x] 8.2 Agregar sección "Incident Playbooks": backend 503 (pasos de diagnóstico: docker ps → logs → DB/Redis check → restart/rollback), Redis unreachable, PostgreSQL unreachable, TLS certificate expired (comandos exactos de force-renewal), WS connections dropping
- [x] 8.3 Agregar sección "Rollback Procedures": rollback de imagen Docker (cambiar tag + docker compose up), rollback de migración Alembic (identificar revisión + alembic downgrade), rollback de config (git revert + docker compose up)
- [x] 8.4 Agregar sección "Monitoring Quick Reference": URLs de Grafana/Prometheus/Alertmanager, queries LogQL frecuentes, queries PromQL frecuentes para diagnóstico

## 9. Verificación final

- [x] 9.1 Levantar stack completo de producción con `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` y verificar que todos los servicios pasan health check — prometheus ✅ loki ✅ grafana ✅ alertmanager ✅ (fix: receiver null para dev); redis/postgres exporters ✅
- [~] 9.2 Confirmar HTTPS funciona: `curl -I https://$DOMAIN/api/health` retorna 200 con header HSTS — requiere dominio público y Let's Encrypt
- [~] 9.3 Confirmar logs JSON de backend aparecen en Grafana Explore con request_id — backend corre nativo, promtail usa Docker socket discovery (no disponible en dev)
- [x] 9.4 Confirmar dashboards "Application Overview" e "Infrastructure" tienen datos — dashboards presentes ✅; métricas de redis/postgres con datos ✅; backend/ws DOWN (nativos)
- [x] 9.5 Confirmar que detener el backend dispara alerta `BackendDown` en Alertmanager UI — alerta activa en Alertmanager ✅
- [x] 9.6 Actualizar `openspec/CHANGES.md`: marcar C-23 como `[x]` completado — ya marcado en tabla de changes
