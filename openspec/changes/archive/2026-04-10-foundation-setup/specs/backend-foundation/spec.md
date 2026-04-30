## ADDED Requirements

### Requirement: FastAPI app exposes health check endpoint
The backend SHALL run a FastAPI application on port 8000 that exposes a `GET /api/health` endpoint returning the application status.

#### Scenario: Health check returns OK
- **WHEN** a GET request is made to `/api/health`
- **THEN** the response SHALL be `{"status": "ok", "version": "0.1.0"}` with HTTP 200

#### Scenario: CORS is configured for local development
- **WHEN** a request arrives from `http://localhost:5176`, `http://localhost:5177`, or `http://localhost:5178`
- **THEN** the CORS middleware SHALL allow the request with credentials

### Requirement: Shared config module uses Pydantic Settings
The `backend/shared/config/settings.py` module SHALL use `pydantic-settings` to load configuration from environment variables and `.env` files. It SHALL include fields for DATABASE_URL, REDIS_URL, JWT_SECRET, TABLE_TOKEN_SECRET, ENVIRONMENT, and DEBUG.

#### Scenario: Settings loads from environment
- **WHEN** the backend starts with `ENVIRONMENT=development` set
- **THEN** `settings.ENVIRONMENT` SHALL equal `"development"`

#### Scenario: Settings provides sensible development defaults
- **WHEN** no `.env` file exists and no environment variables are set
- **THEN** settings SHALL use development defaults that allow the app to start locally

### Requirement: Shared logger provides centralized logging
The `backend/shared/config/logging.py` module SHALL provide a `get_logger(name)` function that returns a configured Python logger. Direct use of `print()` or `logging.getLogger()` is forbidden.

#### Scenario: Logger is callable by name
- **WHEN** calling `get_logger("my_module")`
- **THEN** it SHALL return a logger instance configured with the project's format and level

### Requirement: Shared database module provides session factory
The `backend/shared/infrastructure/db.py` module SHALL provide `get_db()` (async generator for FastAPI dependency injection), `safe_commit(db)` (replaces raw `db.commit()`), and `SessionLocal` (session factory).

#### Scenario: safe_commit handles errors gracefully
- **WHEN** `safe_commit(db)` is called and the commit fails
- **THEN** the session SHALL be rolled back and an appropriate exception SHALL be raised

### Requirement: Shared exceptions module defines base error types
The `backend/shared/utils/exceptions.py` module SHALL define `NotFoundError`, `ForbiddenError`, and `ValidationError` as custom exception classes.

#### Scenario: Custom exceptions are importable
- **WHEN** importing from `shared.utils.exceptions`
- **THEN** `NotFoundError`, `ForbiddenError`, and `ValidationError` SHALL be available

### Requirement: Shared constants module defines enums and role sets
The `backend/shared/config/constants.py` module SHALL define role enums (ADMIN, MANAGER, KITCHEN, WAITER), round status enums, and role sets like `MANAGEMENT_ROLES`.

#### Scenario: Roles are defined as string constants
- **WHEN** importing `MANAGEMENT_ROLES` from constants
- **THEN** it SHALL contain at least ADMIN and MANAGER

### Requirement: Alembic is initialized with dynamic URL resolution
Alembic SHALL be initialized in `backend/alembic/` with an `env.py` that reads `DATABASE_URL` from `shared.config.settings` dynamically. The `alembic.ini` SHALL NOT contain a hardcoded database URL. The `versions/` directory SHALL be empty (no migrations in C-01).

#### Scenario: Alembic env.py resolves URL from settings
- **WHEN** Alembic runs a migration command
- **THEN** it SHALL read the database URL from `settings.DATABASE_URL` and convert async driver to sync

#### Scenario: No migrations exist yet
- **WHEN** inspecting `backend/alembic/versions/`
- **THEN** the directory SHALL be empty (migrations are created in C-02)

### Requirement: Backend test fixtures are set up
The `backend/tests/conftest.py` SHALL provide base pytest fixtures for database and Redis connections suitable for testing.

#### Scenario: A basic health check test passes
- **WHEN** running `python -m pytest tests/ -v` from the backend directory
- **THEN** at least one test (health check) SHALL pass
