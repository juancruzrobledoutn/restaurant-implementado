"""
FastAPI dependency singletons for the WebSocket Gateway.

All long-lived objects (Redis pool, ConnectionManager, EventRouter, CircuitBreakers)
are created once at startup via the lifespan context and stored in module-level
variables. FastAPI dependencies reference these singletons via getter functions.

Startup order (managed by lifespan in main.py):
  1. init_redis(url) — creates the shared aioredis pool
  2. init_connection_manager(redis) — builds all ConnectionManager sub-components
  3. init_event_router(conn_manager) — wires up the EventRouter
  Remaining components are wired in lifespan after these three.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import redis.asyncio as aioredis

if TYPE_CHECKING:
    from ws_gateway.components.connection.manager import ConnectionManager
    from ws_gateway.components.events.router import EventRouter
    from ws_gateway.components.resilience.circuit_breaker import CircuitBreaker

# ── Module-level singletons (set during lifespan startup) ────────────────────

_redis_pool: aioredis.Redis | None = None
_connection_manager: "ConnectionManager | None" = None
_event_router: "EventRouter | None" = None
_circuit_breakers: dict[str, "CircuitBreaker"] = {}


# ── Initializers (called from lifespan) ──────────────────────────────────────

def init_redis(url: str) -> aioredis.Redis:
    global _redis_pool
    _redis_pool = aioredis.from_url(url, decode_responses=True)
    return _redis_pool


def set_connection_manager(manager: "ConnectionManager") -> None:
    global _connection_manager
    _connection_manager = manager


def set_event_router(router: "EventRouter") -> None:
    global _event_router
    _event_router = router


def register_circuit_breaker(name: str, breaker: "CircuitBreaker") -> None:
    _circuit_breakers[name] = breaker


# ── FastAPI dependency getters ────────────────────────────────────────────────

def get_redis_pool() -> aioredis.Redis:
    """Return the shared Redis pool. Must be initialized via init_redis() first."""
    if _redis_pool is None:
        raise RuntimeError("Redis pool not initialized. Call init_redis() during lifespan startup.")
    return _redis_pool


def get_connection_manager() -> "ConnectionManager":
    """Return the ConnectionManager singleton."""
    if _connection_manager is None:
        raise RuntimeError("ConnectionManager not initialized. Check lifespan startup order.")
    return _connection_manager


def get_event_router() -> "EventRouter":
    """Return the EventRouter singleton."""
    if _event_router is None:
        raise RuntimeError("EventRouter not initialized. Check lifespan startup order.")
    return _event_router


def get_circuit_breaker(resource: str) -> "CircuitBreaker":
    """Return a named CircuitBreaker. Raises KeyError if not registered."""
    if resource not in _circuit_breakers:
        raise KeyError(f"CircuitBreaker '{resource}' not registered. Register it during lifespan startup.")
    return _circuit_breakers[resource]


def get_settings():
    """Return the shared settings singleton from backend/shared/config/settings.py."""
    from shared.config.settings import settings
    return settings
