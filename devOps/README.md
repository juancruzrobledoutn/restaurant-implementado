# devOps

Infrastructure and orchestration layer for the Integrador restaurant management system. This directory contains Docker service definitions and cross-platform startup scripts that provision the complete local development environment with a single command.

---

## Overview

The devOps module solves the complexity of coordinating multiple backend services by providing automated orchestration. Rather than manually starting PostgreSQL, Redis, the REST API, and WebSocket Gateway in separate terminals with correct environment variables, developers execute one script that handles the entire lifecycle—from container health verification to graceful shutdown on interrupt signals.

The infrastructure follows a service-oriented architecture where PostgreSQL serves as the persistent data store with vector extension support for AI features, Redis acts as both cache layer and real-time message broker, and two Python services (REST API and WebSocket Gateway) provide the application layer. All components communicate through well-defined network boundaries with health checks ensuring dependent services wait for their dependencies.

---

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Docker Desktop | Latest | Container runtime for PostgreSQL and Redis |
| Python | 3.8+ | Backend framework execution |
| pip | Latest | Python package management |

Docker Desktop must be running before executing the startup scripts. The scripts detect missing Python dependencies and install them automatically from `backend/requirements.txt`.

---

## Directory Contents

```
devOps/
├── docker-compose.yml   # PostgreSQL + Redis service definitions
├── start.ps1            # Windows PowerShell orchestration
├── start.sh             # Unix/Linux/macOS orchestration
└── README.md            # This documentation
```

---

## Docker Services

### PostgreSQL Database

The database service uses `pgvector/pgvector:pg16`, a PostgreSQL 16 image with the pgvector extension pre-installed. This extension enables vector similarity searches required for the RAG chatbot and product recommendation features.

**Connection Details:**
- Host: `localhost`
- Port: `5432`
- Database: `menu_ops`
- Username: `postgres`
- Password: `postgres`

The service includes a health check that polls `pg_isready` every 10 seconds with a 10-second startup grace period. Data persists in a named Docker volume (`integrador_pgdata`) that survives container restarts and even complete removal—only `docker compose down -v` destroys the volume.

### Redis Cache and Message Broker

Redis 7 on Alpine Linux provides three distinct functions within Integrador: caching frequently accessed data, storing session information and rate limit counters, and serving as the pub/sub backbone for real-time WebSocket events.

**Connection Details:**
- Host: `localhost`
- Port: `6380` (intentionally offset from default 6379 to avoid conflicts with local installations)
- Authentication: None (development only)

The service runs with append-only file persistence and a 256MB memory limit using LRU eviction. Health checks verify connectivity through the standard `PING/PONG` protocol. Data persists in the `integrador_redisdata` named volume.

### Ollama (Optional)

The docker-compose file includes a commented Ollama service definition for local LLM execution. Windows users typically achieve better performance running Ollama natively rather than containerized. Uncomment the service block and the corresponding volume to enable containerized execution.

---

## Startup Scripts

Both scripts implement identical four-step startup sequences with platform-appropriate syntax. They must execute from the `backend/` directory where they detect the presence of `rest_api/main.py` to verify correct working directory.

### PowerShell Script (Windows)

```powershell
# From the backend directory
..\devOps\start.ps1                    # Full startup
..\devOps\start.ps1 -SkipDocker        # Skip Docker, use running containers
..\devOps\start.ps1 -ApiOnly           # REST API only (port 8000)
..\devOps\start.ps1 -WsOnly            # WebSocket Gateway only (port 8001)
```

The script manages the REST API as a PowerShell background job while running the WebSocket Gateway in the foreground. This design allows developers to see real-time WebSocket logs while both services remain operational. The `finally` block guarantees cleanup even on unexpected termination.

### Bash Script (Unix/Linux/macOS)

```bash
# From the backend directory
../devOps/start.sh                     # Full startup
../devOps/start.sh --skip-docker       # Skip Docker, use running containers
../devOps/start.sh --api-only          # REST API only (port 8000)
../devOps/start.sh --ws-only           # WebSocket Gateway only (port 8001)
```

The bash script uses process backgrounding with PID tracking and registers a `trap` handler for `SIGINT` and `SIGTERM` signals. Both services run as background processes with `wait` blocking until any child exits, enabling clean shutdown via Ctrl+C.

### Startup Sequence

**Step 1: Docker Containers**
The script invokes `docker compose up -d` and polls health endpoints until both PostgreSQL and Redis report ready status. Maximum wait time is 30 seconds per service before proceeding with a warning.

**Step 2: Python Environment**
Virtual environment detection checks for `venv/` or `.venv/` directories and activates if present. The script continues with system Python if no virtual environment exists.

**Step 3: Dependencies**
A quick import test validates that FastAPI, SQLAlchemy, and Redis packages are available. Missing dependencies trigger automatic `pip install -r requirements.txt`.

**Step 4: Services**
The REST API starts first on port 8000, followed by a 2-second delay, then the WebSocket Gateway on port 8001. The delay ensures the API is accepting connections before the gateway attempts any synchronization.

---

## Common Commands

### Docker Operations

```bash
# Start infrastructure services
docker compose -f devOps/docker-compose.yml up -d

# View running containers and health status
docker compose -f devOps/docker-compose.yml ps

# Stream logs from all services
docker compose -f devOps/docker-compose.yml logs -f

# Stream logs from specific service
docker compose -f devOps/docker-compose.yml logs -f db
docker compose -f devOps/docker-compose.yml logs -f redis

# Stop services (preserves data)
docker compose -f devOps/docker-compose.yml down

# Stop services and destroy all data
docker compose -f devOps/docker-compose.yml down -v

# Restart a specific service
docker compose -f devOps/docker-compose.yml restart redis
```

### Database Access

```bash
# Open PostgreSQL interactive shell
docker compose -f devOps/docker-compose.yml exec db psql -U postgres -d menu_ops

# Execute single SQL command
docker compose -f devOps/docker-compose.yml exec db psql -U postgres -d menu_ops -c "SELECT COUNT(*) FROM products"

# Export database dump
docker compose -f devOps/docker-compose.yml exec db pg_dump -U postgres menu_ops > backup.sql

# Import database dump
docker compose -f devOps/docker-compose.yml exec -T db psql -U postgres menu_ops < backup.sql
```

### Redis Access

```bash
# Open Redis CLI
docker compose -f devOps/docker-compose.yml exec redis redis-cli

# Check all keys
docker compose -f devOps/docker-compose.yml exec redis redis-cli KEYS "*"

# Monitor real-time commands
docker compose -f devOps/docker-compose.yml exec redis redis-cli MONITOR

# Flush all data (development only)
docker compose -f devOps/docker-compose.yml exec redis redis-cli FLUSHALL
```

### Volume Management

```bash
# List volumes
docker volume ls | grep integrador

# Inspect volume details
docker volume inspect integrador_pgdata

# Backup PostgreSQL data
docker run --rm -v integrador_pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pgdata.tar.gz -C /data .

# Restore PostgreSQL data
docker run --rm -v integrador_pgdata:/data -v $(pwd):/backup alpine tar xzf /backup/pgdata.tar.gz -C /data
```

---

## Network Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Host Machine                                 │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │   pwaMenu    │  │  Dashboard   │  │  pwaWaiter   │               │
│  │  :5176       │  │  :5177       │  │  :5178       │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                 │                        │
│         └────────────┬────┴────────┬────────┘                        │
│                      │             │                                 │
│              HTTP/REST      WebSocket                                │
│                      │             │                                 │
│         ┌────────────▼─────────────▼────────────┐                   │
│         │                                        │                   │
│         │  ┌────────────────┐  ┌──────────────┐ │                   │
│         │  │   REST API     │  │  WS Gateway  │ │                   │
│         │  │   :8000        │  │  :8001       │ │                   │
│         │  └───────┬────────┘  └──────┬───────┘ │                   │
│         │          │                  │         │                   │
│         │          └────────┬─────────┘         │                   │
│         │                   │                   │                   │
│         │  ┌────────────────▼────────────────┐  │                   │
│         │  │         Redis (pub/sub)         │  │                   │
│         │  │         :6380                   │  │                   │
│         │  └────────────────┬────────────────┘  │                   │
│         │                   │                   │                   │
│         │  ┌────────────────▼────────────────┐  │                   │
│         │  │       PostgreSQL + pgvector     │  │                   │
│         │  │       :5432                     │  │                   │
│         │  └─────────────────────────────────┘  │                   │
│         │                                        │                   │
│         │            Docker Network              │                   │
│         └────────────────────────────────────────┘                   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Port Assignments

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| REST API | 8000 | HTTP | Authentication, CRUD operations, business logic |
| WebSocket Gateway | 8001 | WebSocket | Real-time events, notifications |
| PostgreSQL | 5432 | PostgreSQL | Persistent data storage |
| Redis | 6380 | Redis | Cache, sessions, pub/sub messaging |
| pwaMenu | 5176 | HTTP | Customer menu interface (dev server) |
| Dashboard | 5177 | HTTP | Admin panel interface (dev server) |
| pwaWaiter | 5178 | HTTP | Waiter application (dev server) |

---

## Environment Configuration

The backend reads configuration from `backend/.env`. Create this file before first startup:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/menu_ops
REDIS_URL=redis://localhost:6380

# Security (generate unique values for each environment)
JWT_SECRET=your-secret-key-minimum-32-characters
TABLE_TOKEN_SECRET=another-secret-key-minimum-32-chars

# CORS (comma-separated allowed origins)
ALLOWED_ORIGINS=http://localhost:5176,http://localhost:5177,http://localhost:5178

# Environment
DEBUG=true
ENVIRONMENT=development
```

Generate secure secrets with:
```bash
# Unix/macOS
openssl rand -base64 32

# PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

---

## Health Checks

### PostgreSQL Health Check

```yaml
test: pg_isready -U postgres -d menu_ops
interval: 10s
timeout: 5s
retries: 5
start_period: 10s
```

The `pg_isready` utility verifies that PostgreSQL accepts connections on the specified database. The 10-second start period allows time for database initialization before health monitoring begins.

### Redis Health Check

```yaml
test: redis-cli ping
interval: 10s
timeout: 5s
retries: 5
start_period: 5s
```

Redis responds to `PING` with `PONG` when operational. The shorter start period reflects Redis's faster initialization compared to PostgreSQL.

### Application Health Endpoints

```bash
# REST API health (sync)
curl http://localhost:8000/api/health

# REST API detailed health (checks DB + Redis)
curl http://localhost:8000/api/health/detailed

# WebSocket Gateway health
curl http://localhost:8001/ws/health

# WebSocket Gateway detailed health
curl http://localhost:8001/ws/health/detailed
```

---

## Troubleshooting

### Docker Issues

**Containers fail to start:**
Verify Docker Desktop is running. On Windows, check that WSL2 backend is enabled and has sufficient memory allocated.

**Port already in use:**
Another service occupies the required port. Identify the process:
```bash
# Unix/macOS
lsof -i :5432
lsof -i :6380

# Windows PowerShell
netstat -ano | findstr :5432
netstat -ano | findstr :6380
```

**Database data corrupted:**
Remove the volume and restart:
```bash
docker compose -f devOps/docker-compose.yml down -v
docker compose -f devOps/docker-compose.yml up -d
```
Note: This destroys all data. The REST API re-seeds demo data on next startup.

### Python Issues

**"Python not found in PATH":**
Install Python 3.8 or later and ensure the installation adds Python to the system PATH.

**Virtual environment not activating:**
Create one if it doesn't exist:
```bash
cd backend
python -m venv venv
```

**Import errors after dependency changes:**
Reinstall all dependencies:
```bash
pip install -r requirements.txt --force-reinstall
```

### Service Issues

**REST API starts but WebSocket Gateway crashes:**
The gateway requires `PYTHONPATH` to include the backend directory. The startup scripts set this automatically, but manual execution needs:
```bash
# Unix/macOS
export PYTHONPATH="$(pwd)/backend"
python -m uvicorn ws_gateway.main:app --port 8001

# Windows PowerShell
$env:PYTHONPATH = "$PWD\backend"
python -m uvicorn ws_gateway.main:app --port 8001
```

**Hot reload not detecting changes:**
Uvicorn's reload mechanism may fail on network-mounted directories or with certain file systems. Restart the service manually when this occurs.

**Redis connection refused:**
Verify Redis container is running and healthy:
```bash
docker compose -f devOps/docker-compose.yml ps redis
docker compose -f devOps/docker-compose.yml logs redis
```

---

## Startup Performance

Typical execution times on a development machine:

| Phase | Duration | Notes |
|-------|----------|-------|
| Docker container startup | 3-5s | First run may pull images (~30s) |
| PostgreSQL health wait | 2-5s | Depends on system resources |
| Redis health wait | 1-2s | Faster than PostgreSQL |
| Python environment check | <1s | Virtual env activation |
| Dependency verification | <1s | Import test only |
| REST API initialization | 2-3s | Database connection + migrations |
| Intentional delay | 2s | Ensures API ready before gateway |
| WebSocket Gateway init | 2-3s | Redis connection + subscriber setup |
| **Total (warm start)** | **15-25s** | Containers already created |
| **Total (cold start)** | **30-60s** | Includes image download |

---

## Production Considerations

This infrastructure configuration targets local development. Production deployments require additional considerations:

**Security hardening:**
- Replace hardcoded credentials with secret management
- Enable Redis authentication
- Use TLS for all connections
- Restrict network exposure

**High availability:**
- PostgreSQL replication (primary/replica)
- Redis Sentinel or Cluster mode
- Multiple API and gateway instances behind load balancer

**Monitoring:**
- Prometheus metrics collection
- Grafana dashboards
- Centralized logging (ELK stack)
- Alerting for health check failures

**Backup strategy:**
- Automated PostgreSQL backups (pg_dump or WAL archiving)
- Redis RDB snapshots to object storage
- Point-in-time recovery capability

---

## Related Documentation

- [backend/README.md](../backend/README.md) - REST API documentation
- [backend/arquiBackend.md](../backend/arquiBackend.md) - Backend architecture
- [ws_gateway/README.md](../ws_gateway/README.md) - WebSocket Gateway documentation
- [ws_gateway/arquiws_gateway.md](../ws_gateway/arquiws_gateway.md) - Gateway architecture
- [CLAUDE.md](../CLAUDE.md) - Project-wide development guidelines
