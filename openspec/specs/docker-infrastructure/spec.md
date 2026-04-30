# docker-infrastructure Specification

## Purpose
TBD - created by archiving change foundation-setup. Update Purpose after archive.
## Requirements
### Requirement: Docker Compose runs PostgreSQL 16 with pgvector
The `devOps/docker-compose.yml` SHALL define a PostgreSQL service using the `pgvector/pgvector:pg16` image, exposed on port 5432, with database name `menu_ops` and user/password `postgres:postgres`.

#### Scenario: PostgreSQL starts and accepts connections
- **WHEN** running `docker compose -f devOps/docker-compose.yml up -d`
- **THEN** PostgreSQL SHALL be accessible on `localhost:5432` and pass its health check (`pg_isready -U postgres`)

#### Scenario: pgvector extension is available
- **WHEN** connecting to the `menu_ops` database
- **THEN** `CREATE EXTENSION IF NOT EXISTS vector` SHALL succeed without errors

### Requirement: Docker Compose runs Redis 7
The `devOps/docker-compose.yml` SHALL define a Redis service using the `redis:7-alpine` image, mapping internal port 6379 to external port 6380, with `allkeys-lru` eviction policy and 256MB memory limit.

#### Scenario: Redis starts and accepts connections
- **WHEN** running `docker compose -f devOps/docker-compose.yml up -d`
- **THEN** Redis SHALL be accessible on `localhost:6380` and respond to `PING` with `PONG`

### Requirement: Docker Compose includes pgAdmin
The `devOps/docker-compose.yml` SHALL define a pgAdmin service for database administration, accessible via web browser.

#### Scenario: pgAdmin is accessible
- **WHEN** Docker Compose services are running
- **THEN** pgAdmin SHALL be accessible on its configured port via web browser

### Requirement: Services have health checks with proper dependencies
All services in Docker Compose SHALL include health checks. The backend service SHALL depend on PostgreSQL and Redis being healthy before starting.

#### Scenario: Backend waits for database
- **WHEN** Docker Compose starts all services
- **THEN** the backend service SHALL NOT start until PostgreSQL and Redis health checks pass

### Requirement: Backup script supports automated PostgreSQL backups
The `devOps/backup/backup.sh` script SHALL perform PostgreSQL backups with rotation (7 daily, 4 weekly).

#### Scenario: Backup script creates a database dump
- **WHEN** running `bash devOps/backup/backup.sh`
- **THEN** a timestamped PostgreSQL dump file SHALL be created in the backup directory

### Requirement: DevOps environment example documents all variables
The `devOps/.env.example` SHALL document all Docker Compose variables including database credentials, Redis configuration, and service ports.

#### Scenario: All Docker variables are documented
- **WHEN** reading `devOps/.env.example`
- **THEN** it SHALL contain at minimum: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PORT`, `JWT_SECRET`

### Requirement: docker-compose.prod.yml includes monitoring stack services
The `devOps/docker-compose.prod.yml` SHALL define the following additional services: `prometheus` (prom/prometheus), `grafana` (grafana/grafana), `loki` (grafana/loki), `promtail` (grafana/promtail), `alertmanager` (prom/alertmanager), `redis_exporter` (oliver006/redis_exporter), `postgres_exporter` (prometheuscommunity/postgres-exporter). All monitoring services SHALL use named volumes for data persistence.

#### Scenario: Monitoring stack starts with docker compose prod
- **WHEN** `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` is run
- **THEN** all monitoring services start successfully and appear as healthy

#### Scenario: Grafana persists dashboards across restarts
- **WHEN** the grafana container is restarted
- **THEN** pre-provisioned dashboards are still available (loaded from volume + provisioning files)

### Requirement: docker-compose.prod.yml includes nginx with TLS and Certbot
The `devOps/docker-compose.prod.yml` SHALL define an `nginx` service using the official nginx image, mounting `devOps/nginx/nginx-ssl.conf` and the Let's Encrypt certificate directory. A `certbot` service SHALL be defined for certificate provisioning and renewal.

#### Scenario: nginx starts with TLS after certificate provisioning
- **WHEN** certificates exist in `devOps/ssl/certbot/conf/live/{DOMAIN}/`
- **THEN** nginx starts successfully and serves HTTPS on port 443

#### Scenario: Certbot container renews certificate automatically
- **WHEN** the certbot container runs its renewal check
- **THEN** certificates with < 30 days remaining are renewed and nginx reloads

### Requirement: Monitoring services are on an isolated Docker network
The monitoring stack services (prometheus, grafana, loki, promtail, alertmanager) SHALL be on a dedicated `monitoring` Docker network in addition to the `backend` network. Backend and ws_gateway SHALL be on both networks to allow Prometheus to scrape them.

#### Scenario: Prometheus can scrape backend metrics
- **WHEN** Prometheus is configured to scrape `http://backend:8000/metrics`
- **THEN** the scrape succeeds (both services are on the shared network)

#### Scenario: Monitoring services are not exposed externally by default
- **WHEN** the monitoring stack is running
- **THEN** Prometheus, Alertmanager, and Loki ports are NOT exposed on the host (only Grafana is optionally exposed)

