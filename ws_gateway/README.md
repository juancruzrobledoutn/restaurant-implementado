# WebSocket Gateway

Real-time event gateway for the Integrador platform. Exposes 4 WebSocket endpoints with dual auth (JWT + Table Token), Circuit Breaker, Worker Pool broadcast, Redis Streams consumer, and event catch-up sorted sets.

**Port**: 8001
**Stack**: FastAPI + uvicorn + Redis 7

---

## Endpoints

### WebSocket Connections

| Endpoint | Auth | Allowed Roles |
|----------|------|---------------|
| `ws://host:8001/ws/waiter?token=<jwt>` | JWT | WAITER, MANAGER, ADMIN |
| `ws://host:8001/ws/kitchen?token=<jwt>` | JWT | KITCHEN, MANAGER, ADMIN |
| `ws://host:8001/ws/admin?token=<jwt>` | JWT | ADMIN, MANAGER |
| `ws://host:8001/ws/diner?token=<table_token>` | Table Token | (no roles) |

Token is passed as a query string parameter `?token=<value>`.

### HTTP Catch-up

```
GET /ws/catchup?branch_id=<id>&since=<timestamp_ms>&token=<jwt>
GET /ws/catchup/session?session_id=<id>&since=<timestamp_ms>&table_token=<token>
```

Returns missed events (Redis sorted sets, max 100 events, 5 min TTL).

### Health and Metrics

```
GET /health                  — liveness check (200 always if process is alive)
GET /health/detailed         — Redis ping + circuit breaker states + active connections
GET /ws/metrics?token=<tok>  — full stats (protected by WS_METRICS_TOKEN in production)
```

---

## Architecture

```
                    JWTAuthStrategy
                  /
WS Endpoint ──> CompositeAuthStrategy ──> ConnectionManager (facade)
                  \                              |
                    TableTokenAuthStrategy   5 sub-components:
                                              ├── ConnectionIndex     (in-memory registry)
                                              ├── ConnectionLifecycle (accept/disconnect)
                                              ├── ConnectionBroadcaster (10 workers, queue 5000)
                                              ├── ConnectionCleanup   (background task)
                                              └── ConnectionStats     (metrics)

Redis Pub/Sub ──> RedisSubscriber ──> EventRouter ──> ConnectionManager.broadcast_*
Redis Streams ──> StreamConsumer ──> EventRouter     (same routing)
                                         |
                                    CatchupPublisher ──> Redis sorted sets
```

**Patterns**:
- **Strategy**: Pluggable auth (JWT / Table Token / Composite / Null for tests)
- **Composition**: `ConnectionManager` is a facade over 5 independent sub-components
- **Circuit Breaker**: 3 independent breakers (pubsub / streams / catchup), CLOSED→OPEN→HALF_OPEN
- **Worker Pool**: 10 permanent asyncio workers, `asyncio.Queue(maxsize=5000)`, fallback batch mode

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6380` | Redis connection URL |
| `JWT_SECRET` | (dev default) | Must match backend JWT_SECRET |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm |
| `TABLE_TOKEN_SECRET` | (dev default) | Must match backend TABLE_TOKEN_SECRET |
| `TABLE_TOKEN_TTL_SECONDS` | `10800` | 3 hours |
| `WS_MAX_CONNECTIONS` | `1000` | Global connection cap |
| `WS_MAX_CONNECTIONS_PER_USER` | `3` | Per-user connection limit |
| `WS_HEARTBEAT_INTERVAL` | `30` | Ping interval in seconds |
| `WS_HEARTBEAT_TIMEOUT` | `60` | Stale connection timeout in seconds |
| `WS_RATE_LIMIT_PER_WINDOW` | `30` | Max messages per window per connection |
| `WS_RATE_LIMIT_WINDOW_SECONDS` | `1` | Rate limit window in seconds |
| `WS_CATCHUP_TTL_SECONDS` | `300` | Catch-up sorted set TTL (5 min) |
| `WS_CATCHUP_MAX_EVENTS` | `100` | Max events per catch-up key |
| `WS_BROADCAST_WORKERS` | `10` | Worker pool size |
| `WS_BROADCAST_QUEUE_SIZE` | `5000` | Broadcast queue max size |
| `WS_STREAM_CRITICAL` | `events:critical` | Redis Streams key for critical events |
| `WS_STREAM_GROUP` | `ws_gateway_group` | Consumer group name |
| `WS_STREAM_DLQ` | `events:dlq` | Dead Letter Queue stream key |
| `WS_STREAM_MAX_DELIVERIES` | `3` | Retries before DLQ |
| `WS_ALLOWED_ORIGINS` | `` | Comma-separated allowed origins (required in production) |
| `WS_ALLOW_NO_ORIGIN` | `false` | Allow connections without Origin header |
| `WS_METRICS_TOKEN` | `` | Token to protect /ws/metrics in production |
| `ENVIRONMENT` | `development` | `development` / `staging` / `production` |

Copy `ws_gateway/.env.example` to `ws_gateway/.env` and customize.

---

## Running Tests

```bash
# From repo root
cd backend && PYTHONPATH=. pytest ../ws_gateway/tests/ -v

# Or from ws_gateway directory
PYTHONPATH=../backend pytest tests/ -v

# Skip stream consumer tests (require real Redis 7+ with XAUTOCLAIM)
PYTHONPATH=../backend pytest tests/ -v -m "not real_redis"

# With coverage
PYTHONPATH=../backend pytest tests/ --cov=ws_gateway --cov-report=term-missing
```

**Test prerequisites**:
- `fakeredis>=2.26.2` (most tests use in-memory Redis)
- Tests marked `@pytest.mark.real_redis` require Redis at `localhost:6380`
  - Start with: `docker compose -f devOps/docker-compose.yml up redis -d`
  - These tests are automatically skipped if Redis is unavailable

---

## Running Locally

```bash
# Start Redis
docker compose -f devOps/docker-compose.yml up redis -d

# From repo root
PYTHONPATH=backend python -m uvicorn ws_gateway.main:app --port 8001 --reload

# Test with wscat
npm install -g wscat
wscat -c "ws://localhost:8001/ws/admin?token=<your-jwt>"
```

---

## Docker

```bash
# Build
docker build -f ws_gateway/Dockerfile -t integrador-ws-gateway .

# Run with docker compose
docker compose -f devOps/docker-compose.yml up ws_gateway
```

---

## Troubleshooting

### Redis down

`GET /health/detailed` will return 503 with `"redis": "error"`.

- Check Redis is running: `docker compose ps redis`
- Check `REDIS_URL` matches the exposed port (default: 6380)
- CircuitBreaker will open after 5 failures — all events will be dropped until Redis recovers

### Consumer group lag

Check how far behind the consumer is:

```bash
# Connect to Redis
redis-cli -p 6380

# Check pending messages in the stream
XPENDING events:critical ws_gateway_group - + 10

# Check DLQ size
XLEN events:dlq

# Inspect DLQ entries
XRANGE events:dlq - + COUNT 5
```

### DLQ inspection

Messages that failed 3+ deliveries end up in `events:dlq`:

```bash
redis-cli -p 6380 XRANGE events:dlq - + COUNT 10
```

Each entry contains:
- `payload`: original event JSON
- `reason`: error message from the last failed routing attempt
- `original_id`: stream message ID from `events:critical`

### WebSocket connections not accepted

1. Check `Origin` header — must match `WS_ALLOWED_ORIGINS` in production
2. In development, set `WS_ALLOW_NO_ORIGIN=true` to allow wscat/headless clients
3. Check JWT expiry — tokens expire after 15 minutes (ACCESS_TOKEN_TTL)
4. Verify `WS_MAX_CONNECTIONS` limit (default: 1000)

### RATE_LIMITED close (code 4029)

The client sent more than `WS_RATE_LIMIT_PER_WINDOW` (30) messages in `WS_RATE_LIMIT_WINDOW_SECONDS` (1 second). Repeated offenders are flagged as abusive for 60 seconds.

### Auth failure (close code 4001 / 4003)

| Code | Meaning |
|------|---------|
| 4001 | JWT invalid / expired / blacklisted, or Table Token HMAC mismatch |
| 4003 | Authenticated but role not allowed for this endpoint |
| 4029 | Rate limited |
