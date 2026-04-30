# ci-pipeline Specification

## Purpose
TBD - created by archiving change foundation-setup. Update Purpose after archive.
## Requirements
### Requirement: GitHub Actions CI runs 4 parallel jobs
The `.github/workflows/ci.yml` SHALL define 4 parallel jobs: `backend`, `dashboard`, `pwa-menu`, and `pwa-waiter`. Each job SHALL run independently on `ubuntu-latest`.

#### Scenario: CI triggers on push and pull request to main and develop
- **WHEN** a push or pull request targets `main` or `develop` branch
- **THEN** all 4 CI jobs SHALL trigger and run in parallel

### Requirement: Backend CI job runs pytest with service containers
The `backend` CI job SHALL provision PostgreSQL 16 (pgvector) and Redis 7 as service containers, install Python 3.12 dependencies, and run `pytest tests/ -v --tb=short`.

#### Scenario: Backend tests run with real database
- **WHEN** the backend CI job runs
- **THEN** it SHALL use a PostgreSQL service container on port 5432 and Redis on port 6380 with `ENVIRONMENT=test`

### Requirement: Frontend CI jobs run lint, type-check, test, and build
Each frontend CI job (dashboard, pwa-menu, pwa-waiter) SHALL run the following steps in sequence: `npm install`, `npm run lint`, `npm run type-check`, `npm run test:run`, `npm run build`.

#### Scenario: Dashboard CI validates all quality gates
- **WHEN** the dashboard CI job runs
- **THEN** it SHALL execute lint, type-check, test:run, and build steps using Node.js 22

#### Scenario: pwaMenu CI validates all quality gates
- **WHEN** the pwa-menu CI job runs
- **THEN** it SHALL execute lint, type-check, test:run, and build steps using Node.js 22

#### Scenario: pwaWaiter CI validates all quality gates
- **WHEN** the pwa-waiter CI job runs
- **THEN** it SHALL execute lint, type-check, test:run, and build steps using Node.js 22

### Requirement: CI uses correct environment variables
The CI pipeline SHALL set environment variables appropriate for testing: `ENVIRONMENT=test`, test database URL, and test Redis URL. `JWT_SECRET` SHALL be provided via `${JWT_SECRET}` without hardcoded default values.

#### Scenario: JWT_SECRET is not hardcoded in CI
- **WHEN** inspecting the CI workflow file
- **THEN** `JWT_SECRET` SHALL reference a GitHub secret or environment variable, not a hardcoded string

