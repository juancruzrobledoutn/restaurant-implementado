## ADDED Requirements

### Requirement: Monorepo directory structure follows target architecture
The repository SHALL contain the following top-level directories: `backend/`, `ws_gateway/`, `Dashboard/`, `pwaMenu/`, `pwaWaiter/`, `shared/`, `devOps/`, `e2e/`. Each directory SHALL contain the minimum scaffolding files to be recognized as a valid project by its respective tooling.

#### Scenario: All required directories exist
- **WHEN** a developer clones the repository after C-01 is complete
- **THEN** all 8 top-level project directories (`backend/`, `ws_gateway/`, `Dashboard/`, `pwaMenu/`, `pwaWaiter/`, `shared/`, `devOps/`, `e2e/`) SHALL exist with their initial scaffolding files

#### Scenario: Backend follows Clean Architecture directory layout
- **WHEN** inspecting `backend/`
- **THEN** it SHALL contain `rest_api/` (with `main.py`, `models/`, `routers/`, `services/domain/`), `shared/` (with `config/`, `infrastructure/`, `security/`, `utils/`), `alembic/`, and `tests/`

#### Scenario: Each frontend has independent project setup
- **WHEN** inspecting `Dashboard/`, `pwaMenu/`, or `pwaWaiter/`
- **THEN** each SHALL contain `src/` directory, `package.json`, `vite.config.ts`, `tsconfig.json`, and `index.html`

### Requirement: Shared TypeScript module provides WebSocket client base
The `shared/` directory SHALL contain a `websocket-client.ts` file with a `BaseWebSocketClient` abstract class that serves as the foundation for WebSocket clients in all frontends.

#### Scenario: Shared module is importable
- **WHEN** a frontend project imports from `shared/websocket-client`
- **THEN** the `BaseWebSocketClient` class SHALL be available as an export

### Requirement: Environment example files exist in every sub-project
Each sub-project (`backend/`, `Dashboard/`, `pwaMenu/`, `pwaWaiter/`, `devOps/`) SHALL include a `.env.example` file documenting all required environment variables with placeholder values and comments.

#### Scenario: Backend .env.example contains all required variables
- **WHEN** reading `backend/.env.example`
- **THEN** it SHALL contain at minimum: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `TABLE_TOKEN_SECRET`, `ENVIRONMENT`, `DEBUG`

#### Scenario: Frontend .env.example files contain API URLs
- **WHEN** reading any frontend `.env.example`
- **THEN** Dashboard SHALL contain `VITE_API_URL=http://localhost:8000` (without `/api` suffix) and pwaMenu/pwaWaiter SHALL contain `VITE_API_URL=http://localhost:8000/api` (with `/api` suffix) and `VITE_WS_URL=ws://localhost:8001`
