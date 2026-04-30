"""
WebSocket Gateway — FastAPI application entry point.

Architecture:
  - Composition Pattern: ConnectionManager is a facade over 5 sub-components.
  - Strategy Pattern: Auth is pluggable (JWTAuthStrategy / TableTokenAuthStrategy).
  - Circuit Breaker: 3 independent breakers (pubsub / streams / catchup).
  - Worker Pool: 10 background workers for broadcast fan-out.

Startup order (lifespan):
  1. Validate configuration (fail-start on missing production secrets).
  2. Initialize Redis pool.
  3. Build ConnectionManager (Lifecycle + Index + Broadcaster + Cleanup + Stats).
  4. Build EventRouter + CatchupPublisher.
  5. Start broadcast workers.
  6. Start Redis Pub/Sub subscriber.
  7. Start Redis Streams consumer.
  8. Start connection cleanup background task.
  9. Start auth revalidation background task.

Shutdown order (reverse):
  1. Stop accepting new WebSocket handshakes (flag).
  2. Stop auth revalidator.
  3. Stop connection cleanup.
  4. Stop stream consumer (pending ACKs will be re-claimed on next start).
  5. Stop pub/sub subscriber.
  6. Close all active connections with code 1001 (GOING_AWAY).
  7. Stop broadcast workers (drain queue with timeout).
  8. Close Redis pool.
"""
from __future__ import annotations

import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── Fail-start validation ─────────────────────────────────────────────────────
# Called before building the app — exits if config is invalid.

def _validate_startup_config() -> None:
    """
    Fail-start checks:
      1. ENVIRONMENT=production + WS_ALLOWED_ORIGINS empty → exit(1)
      2. JWT_SECRET or TABLE_TOKEN_SECRET are defaults in production → exit(1)
         (delegated to shared/config/settings.py validate_production_secrets)

    NullAuthStrategy check is done at endpoint registration time (not applicable
    here since endpoints use concrete strategies; the router module enforces this).
    """
    import os
    from shared.config.settings import settings, validate_production_secrets

    env = settings.ENVIRONMENT
    if env == "production":
        errors = []
        if not settings.WS_ALLOWED_ORIGINS:
            errors.append(
                "WS_ALLOWED_ORIGINS must be set in production "
                "(comma-separated list of allowed WebSocket origins)"
            )
        try:
            validate_production_secrets(settings)
        except ValueError as exc:
            errors.append(str(exc))

        if errors:
            for error in errors:
                print(f"[FATAL] ws_gateway startup: {error}", file=sys.stderr)
            sys.exit(1)


# Run validation at import time so tests that set env vars can patch it
# In tests, the import guard prevents exit(1) since ENVIRONMENT != "production"
_validate_startup_config()


# ── Lifespan ─────────────────────────────────────────────────────────────────

_accepting_new_connections = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Orchestrate startup and shutdown of all Gateway components.

    Startup order matters: Broadcaster before Subscriber before StreamConsumer
    because events arriving before workers are running would be lost.
    """
    global _accepting_new_connections
    _accepting_new_connections = True

    from shared.config.settings import settings
    from ws_gateway.core.dependencies import (
        init_redis,
        register_circuit_breaker,
        set_connection_manager,
        set_event_router,
    )
    from ws_gateway.components.connection.broadcaster import BroadcastObserver, ConnectionBroadcaster
    from ws_gateway.components.connection.cleanup import ConnectionCleanup
    from ws_gateway.components.connection.heartbeat import HeartbeatTracker
    from ws_gateway.components.connection.index import ConnectionIndex
    from ws_gateway.components.connection.lifecycle import ConnectionLifecycle
    from ws_gateway.components.connection.manager import ConnectionManager, ConnectionManagerDependencies
    from ws_gateway.components.connection.rate_limiter import RateLimiter
    from ws_gateway.components.connection.stats import ConnectionStats
    from ws_gateway.components.events.catchup_publisher import CatchupPublisher
    from ws_gateway.components.events.redis_subscriber import RedisSubscriber
    from ws_gateway.components.events.router import EventRouter
    from ws_gateway.components.events.stream_consumer import StreamConsumer
    from ws_gateway.components.auth.revalidation import AuthRevalidator
    from ws_gateway.components.resilience.circuit_breaker import CircuitBreaker
    from ws_gateway.core.logger import get_logger

    logger = get_logger(__name__)
    logger.info("ws_gateway starting up...")

    # ── 1. Redis pool ──────────────────────────────────────────────────────
    redis = init_redis(settings.REDIS_URL)

    # ── 2. Circuit breakers (one per logical resource) ────────────────────
    pubsub_breaker = CircuitBreaker(name="redis_pubsub")
    stream_breaker = CircuitBreaker(name="redis_stream")
    catchup_breaker = CircuitBreaker(name="redis_catchup")
    register_circuit_breaker("redis_pubsub", pubsub_breaker)
    register_circuit_breaker("redis_stream", stream_breaker)
    register_circuit_breaker("redis_catchup", catchup_breaker)

    # ── 3. ConnectionManager sub-components ──────────────────────────────
    index = ConnectionIndex()
    stats = ConnectionStats()
    rate_limiter = RateLimiter(redis=redis)
    heartbeat = HeartbeatTracker()
    lifecycle = ConnectionLifecycle(index=index, rate_limiter=rate_limiter, stats=stats)
    observer = BroadcastObserver(stats=stats)
    broadcaster = ConnectionBroadcaster(
        observer=observer,
        n_workers=settings.WS_BROADCAST_WORKERS,
        queue_size=settings.WS_BROADCAST_QUEUE_SIZE,
    )
    cleanup = ConnectionCleanup(index=index, heartbeat=heartbeat, lifecycle=lifecycle)
    deps = ConnectionManagerDependencies(
        lifecycle=lifecycle, index=index, broadcaster=broadcaster,
        cleanup=cleanup, stats=stats, heartbeat=heartbeat,
    )
    conn_manager = ConnectionManager(deps)
    set_connection_manager(conn_manager)

    # ── 4. EventRouter + CatchupPublisher ─────────────────────────────────
    catchup_publisher = CatchupPublisher(redis=redis, circuit_breaker=catchup_breaker)
    event_router = EventRouter(conn_manager=conn_manager, catchup_publisher=catchup_publisher)
    set_event_router(event_router)

    # ── 5. Start workers (broadcast pool) ────────────────────────────────
    await broadcaster.start_workers(settings.WS_BROADCAST_WORKERS)

    # ── 6. Pub/Sub subscriber ─────────────────────────────────────────────
    redis_subscriber = RedisSubscriber(
        redis_factory=lambda: __import__("redis.asyncio", fromlist=["Redis"]).from_url(
            settings.REDIS_URL, decode_responses=True
        ),
        event_router=event_router,
        circuit_breaker=pubsub_breaker,
    )
    await redis_subscriber.start()

    # ── 7. Stream consumer ────────────────────────────────────────────────
    stream_consumer = StreamConsumer(
        redis=redis,
        event_router=event_router,
        circuit_breaker=stream_breaker,
    )
    await stream_consumer.start()

    # ── 8. Cleanup task ───────────────────────────────────────────────────
    await cleanup.start()

    # ── 9. Auth revalidator ───────────────────────────────────────────────
    auth_revalidator = AuthRevalidator(conn_index=index)
    await auth_revalidator.start()

    logger.info("ws_gateway startup complete — accepting connections on port %d", settings.WS_PORT)

    # ── Yield: application is running ─────────────────────────────────────
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────
    logger.info("ws_gateway shutting down...")
    _accepting_new_connections = False

    await auth_revalidator.stop()
    await cleanup.stop()
    await stream_consumer.stop()
    await redis_subscriber.stop()

    # Close all active connections with GOING_AWAY
    await conn_manager.disconnect_all(code=1001)

    # Drain broadcast queue
    await broadcaster.stop_workers(timeout=5.0)

    # Close Redis pool
    await redis.aclose()

    logger.info("ws_gateway shutdown complete")


# ── Middleware ────────────────────────────────────────────────────────────────

async def _shutdown_middleware(request: Request, call_next):
    """Return 503 to new WebSocket upgrade requests during shutdown."""
    if not _accepting_new_connections:
        if request.headers.get("upgrade", "").lower() == "websocket":
            return JSONResponse(
                status_code=503,
                content={"detail": "Gateway is shutting down, please reconnect later"},
            )
    return await call_next(request)


# ── App construction ──────────────────────────────────────────────────────────

app = FastAPI(
    title="Integrador WebSocket Gateway",
    version="0.9.0",
    description=(
        "Real-time event gateway for the Integrador platform. "
        "Serves 4 WS endpoints (/ws/waiter, /ws/kitchen, /ws/admin, /ws/diner) "
        "with dual auth (JWT + Table Token HMAC), Circuit Breaker, Worker Pool "
        "broadcast, Redis Streams consumer, event catch-up sorted sets, and "
        "per-connection rate limiting."
    ),
    lifespan=lifespan,
)

app.middleware("http")(_shutdown_middleware)

# RequestIDMiddleware: assigns uuid4 per request, stores in ContextVar,
# adds X-Request-ID to response. Must be added AFTER _shutdown_middleware
# so it is outermost — every request gets a request_id before any handler sees it.
from shared.middleware.request_id import RequestIDMiddleware  # noqa: E402
app.add_middleware(RequestIDMiddleware)

# Include routers
from ws_gateway.routers.websocket import router as ws_router
from ws_gateway.routers.catchup import router as catchup_router
from ws_gateway.routers.health import router as health_router

app.include_router(ws_router)
app.include_router(catchup_router)
app.include_router(health_router)
