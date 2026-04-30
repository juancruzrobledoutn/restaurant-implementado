# log-aggregation Specification

## Purpose
TBD - created by archiving change monitoring-production. Update Purpose after archive.
## Requirements
### Requirement: All services emit structured JSON logs with context fields
The backend and ws_gateway SHALL emit logs in JSON format. Every log line SHALL include: `timestamp`, `level`, `service`, `message`, `request_id` (when in request context), `user_id` (when authenticated), `tenant_id` (when available).

#### Scenario: Backend logs a request with full context
- **WHEN** an authenticated request is processed by the backend
- **THEN** every log line for that request includes `request_id`, `user_id`, and `tenant_id`

#### Scenario: Backend logs a public request without auth context
- **WHEN** a public endpoint (e.g., `/api/public/menu/{slug}`) is processed
- **THEN** log lines include `request_id` but omit `user_id` and `tenant_id`

#### Scenario: ws_gateway logs use the same JSON format
- **WHEN** the ws_gateway handles a WebSocket connection or event
- **THEN** the log output is JSON with the same fields as the backend

### Requirement: Promtail ships logs from all services to Loki
Promtail SHALL scrape log output from Docker containers (via Docker socket or log files) and ship them to Loki with labels: `job`, `service`, `container`.

#### Scenario: Backend logs appear in Loki within 10 seconds
- **WHEN** a log line is emitted by the backend container
- **THEN** within 10 seconds the log line is queryable in Loki via Grafana Explore

#### Scenario: Logs are queryable by service
- **WHEN** a user queries Loki with `{service="backend"}`
- **THEN** only logs from the backend service are returned

### Requirement: Loki retains logs for 30 days by default
Loki SHALL enforce a configurable retention period (default 30 days). Logs older than the retention period SHALL be automatically deleted.

#### Scenario: Log retention is configurable
- **WHEN** `LOKI_RETENTION_PERIOD` environment variable is set
- **THEN** Loki applies the specified retention period

#### Scenario: Old logs are purged automatically
- **WHEN** a log entry is older than the retention period
- **THEN** Loki's compactor deletes it without manual intervention

### Requirement: Grafana Explore enables log querying with LogQL
Grafana SHALL be pre-configured with Loki as a data source. Users SHALL be able to query logs via LogQL in Grafana Explore.

#### Scenario: Logs for a specific request_id are retrievable
- **WHEN** a user queries `{service="backend"} |= "request_id=<uuid>"`
- **THEN** all log lines for that request are returned in chronological order

