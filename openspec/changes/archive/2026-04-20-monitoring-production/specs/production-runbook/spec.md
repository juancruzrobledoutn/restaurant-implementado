## ADDED Requirements

### Requirement: RUNBOOK.md contains a production deployment checklist
`devOps/RUNBOOK.md` SHALL contain a step-by-step pre-deployment checklist covering: environment variables validation, TLS certificate status, database migration state, service health checks, smoke test commands.

#### Scenario: Operator follows checklist before deploy
- **WHEN** an operator reads the RUNBOOK.md deployment section
- **THEN** they can execute each step sequentially to verify the system is ready for production traffic

#### Scenario: All required environment variables are documented
- **WHEN** an operator reads the environment variables section
- **THEN** every required production env var is listed with its description and an example value

### Requirement: RUNBOOK.md contains incident playbooks for common failure scenarios
`devOps/RUNBOOK.md` SHALL contain playbooks for: backend service down, Redis unreachable, PostgreSQL unreachable, TLS certificate expired, WebSocket connections dropping at scale.

#### Scenario: On-call engineer can diagnose a backend outage
- **WHEN** the backend is returning 503s
- **THEN** the RUNBOOK playbook guides the engineer through: checking container status, reading logs from Loki, checking DB/Redis connectivity, and performing a service restart or rollback

#### Scenario: Expired certificate recovery is documented
- **WHEN** the TLS certificate expires unexpectedly
- **THEN** the RUNBOOK contains the exact commands to force certificate renewal and nginx reload

### Requirement: RUNBOOK.md contains rollback procedures
`devOps/RUNBOOK.md` SHALL document rollback procedures for: application code (docker compose deploy previous image), database migrations (alembic downgrade), configuration changes (restore from git).

#### Scenario: Operator can rollback application to previous version
- **WHEN** a deploy introduces a regression
- **THEN** the RUNBOOK documents the exact `docker compose` commands to restore the previous image tag

#### Scenario: Alembic downgrade procedure is documented
- **WHEN** a migration needs to be reverted
- **THEN** the RUNBOOK explains how to identify the target revision and run `alembic downgrade <revision>`
