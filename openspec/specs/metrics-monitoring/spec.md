# metrics-monitoring Specification

## Purpose
TBD - created by archiving change monitoring-production. Update Purpose after archive.
## Requirements
### Requirement: Backend and ws_gateway expose Prometheus metrics endpoint
The backend SHALL expose `GET /metrics` (Prometheus format) via `prometheus-fastapi-instrumentator`. The ws_gateway SHALL expose its own `GET /metrics` endpoint. Both SHALL include: request count, request latency histograms (p50/p95/p99), active connections.

#### Scenario: Backend metrics endpoint returns Prometheus data
- **WHEN** Prometheus scrapes `GET http://backend:8000/metrics`
- **THEN** the response is valid Prometheus text format with `http_request_duration_seconds` histogram

#### Scenario: ws_gateway metrics include active WebSocket connections
- **WHEN** Prometheus scrapes `GET http://ws_gateway:8001/metrics`
- **THEN** the response includes `websocket_connections_active` gauge

### Requirement: Prometheus scrapes all services on a configurable interval
Prometheus SHALL be configured (via `prometheus.yml`) to scrape backend, ws_gateway, Redis (via redis_exporter), and PostgreSQL (via postgres_exporter) every 15 seconds by default.

#### Scenario: All targets are healthy in Prometheus
- **WHEN** Prometheus starts and scrapes all configured targets
- **THEN** all targets appear as `UP` in the Prometheus targets page

#### Scenario: Redis memory metrics are available
- **WHEN** redis_exporter is running
- **THEN** `redis_memory_used_bytes` metric is available in Prometheus

### Requirement: Grafana dashboards are pre-provisioned from JSON files
Grafana SHALL load dashboards automatically from `devOps/monitoring/grafana/provisioning/dashboards/`. At minimum, two dashboards SHALL be provisioned: "Application Overview" (requests/s, latency p95, error rate) and "Infrastructure" (Redis memory, DB connections, WS connections).

#### Scenario: Dashboards are available immediately after docker compose up
- **WHEN** Grafana starts with provisioning config mounted
- **THEN** the "Application Overview" and "Infrastructure" dashboards are immediately accessible without manual import

#### Scenario: Application Overview dashboard shows request rate
- **WHEN** the "Application Overview" dashboard is opened
- **THEN** it displays requests/second, p95 latency, and 5xx error rate for the backend

### Requirement: Alertmanager fires alerts for critical conditions
Alertmanager SHALL be configured with alert rules for: 5xx error rate > 1% for 5 minutes, any service (backend/ws_gateway/redis/postgres) being down for > 1 minute, request latency p95 > 2 seconds for 5 minutes, rate limit responses (429) spike > 50/minute.

#### Scenario: Alert fires when backend error rate exceeds threshold
- **WHEN** the backend 5xx error rate exceeds 1% sustained for 5 minutes
- **THEN** Alertmanager sends a notification to the configured webhook URL

#### Scenario: Alert fires when Redis is unreachable
- **WHEN** `redis_exporter` fails to connect to Redis for > 1 minute
- **THEN** Alertmanager fires the `RedisDown` alert

#### Scenario: Alerts are routed to webhook
- **WHEN** `ALERTMANAGER_WEBHOOK_URL` is set in environment
- **THEN** Alertmanager POSTs alert payloads to that URL

#### Scenario: Alert resolves when condition clears
- **WHEN** a firing alert condition is no longer met
- **THEN** Alertmanager sends a resolve notification to the webhook

