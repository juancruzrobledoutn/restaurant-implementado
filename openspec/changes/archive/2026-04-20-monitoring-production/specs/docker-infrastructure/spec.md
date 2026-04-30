## ADDED Requirements

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
