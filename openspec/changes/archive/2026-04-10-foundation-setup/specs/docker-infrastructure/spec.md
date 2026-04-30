## ADDED Requirements

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
