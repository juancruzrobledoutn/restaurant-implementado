"""
WebSocket endpoints for the Gateway.

Endpoints:
  /ws/waiter      — JWT, roles: WAITER | MANAGER | ADMIN
  /ws/kitchen     — JWT, roles: KITCHEN | MANAGER | ADMIN
  /ws/admin       — JWT, roles: ADMIN | MANAGER
  /ws/diner       — Table Token (HMAC), no role check

Close code semantics (see core/constants.py WSCloseCode):
  4001 — auth failed or token expired (no reconnect)
  4003 — role/branch mismatch (no reconnect)
  4029 — rate limit / connection limit (no reconnect)
  1000 — normal close (reconnect allowed in reconnection-eligible flows)
  1011 — server error (reconnect with backoff)

Origin validation:
  Every handshake is validated against WS_ALLOWED_ORIGINS BEFORE websocket.accept().
  Missing/unknown origin → HTTP 403 (rejected before WS handshake).
  Set WS_ALLOW_NO_ORIGIN=true to allow server-to-server connections without Origin header.

Inbound message protocol:
  {"type": "ping"} → {"type": "pong"}
  Any other message → heartbeat updated + rate-limit check
  Rate limit exceeded → close 4029
"""
from __future__ import annotations

import json
from typing import Callable

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ws_gateway.components.auth.strategies import AuthError, AuthStrategy, NullAuthStrategy
from ws_gateway.components.connection.lifecycle import ConnectionRejectedError
from ws_gateway.core.constants import DEFAULT_CORS_ORIGINS, WSCloseCode
from ws_gateway.core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


# ── Origin validation ─────────────────────────────────────────────────────────

def _validate_origin(websocket: WebSocket, allowed_origins: list[str], allow_no_origin: bool) -> bool:
    """
    Validate the Origin header of a WS handshake.

    Returns True if allowed, False if rejected.
    Rejection MUST happen before websocket.accept().
    """
    origin = websocket.headers.get("origin")
    if origin is None:
        return allow_no_origin

    return origin in allowed_origins


# ── Shared endpoint helper ────────────────────────────────────────────────────

async def _websocket_endpoint(
    websocket: WebSocket,
    token: str,
    strategy: AuthStrategy,
    conn_manager,
    rate_limiter,
    settings,
) -> None:
    """
    Generic WebSocket endpoint handler.

    Steps:
      1. Validate Origin → reject with 403 if invalid.
      2. Authenticate token via strategy → reject with close code if invalid.
      3. Connect (lifecycle checks) → reject with close code if rejected.
      4. Message loop: ping/pong + heartbeat + rate-limit.
      5. Disconnect on any error or clean close.
    """
    # Step 1: Origin check
    allowed_origins = (
        [o.strip() for o in settings.WS_ALLOWED_ORIGINS.split(",") if o.strip()]
        if settings.WS_ALLOWED_ORIGINS
        else DEFAULT_CORS_ORIGINS
    )
    allow_no_origin = getattr(settings, "WS_ALLOW_NO_ORIGIN", False)

    if not _validate_origin(websocket, allowed_origins, allow_no_origin):
        origin = websocket.headers.get("origin", "<none>")
        logger.warning("WebSocket: rejected invalid Origin=%s", origin)
        await websocket.close(code=403)
        return

    # Step 2: Authenticate
    try:
        auth_result = await strategy.authenticate(token)
    except AuthError as exc:
        logger.warning("WebSocket: auth failed: %s (code=%d)", exc, exc.close_code)
        if websocket.client_state != WebSocketState.CONNECTED:
            try:
                await websocket.close(code=exc.close_code)
            except Exception:
                pass
        return

    # Step 3: Connect
    try:
        conn = await conn_manager.connect(websocket, auth_result, strategy=strategy)
    except ConnectionRejectedError as exc:
        logger.warning("WebSocket: connection rejected: %s (code=%d)", exc, exc.close_code)
        # websocket.accept() was NOT called — send HTTP 4xx
        try:
            await websocket.close(code=exc.close_code)
        except Exception:
            pass
        return

    # Determine user or diner ID for rate limiting
    user_id = auth_result.user_id if auth_result.user_id is not None else auth_result.diner_id
    device_id = conn.connection_id  # unique per connection (prevents reset on reconnect via user_id)

    # Step 4: Message loop
    try:
        async for message in websocket.iter_text():
            # Update heartbeat on EVERY message
            conn_manager.update_heartbeat(conn.connection_id)

            # Parse message
            try:
                data = json.loads(message)
            except (json.JSONDecodeError, ValueError):
                continue

            # Ping/pong protocol
            if data.get("type") == "ping":
                try:
                    await websocket.send_text(json.dumps({"type": "pong"}))
                except Exception:
                    break
                continue

            # Rate limit check for non-ping messages
            if user_id is not None:
                allowed = await rate_limiter.check_and_increment(user_id, device_id)
                if not allowed:
                    await rate_limiter.mark_abusive(user_id)
                    await conn_manager.disconnect(conn, code=WSCloseCode.RATE_LIMITED)
                    return

    except WebSocketDisconnect:
        logger.info("WebSocket: client disconnected connection_id=%s", conn.connection_id)
    except Exception as exc:
        logger.error("WebSocket: unexpected error in message loop: %s", exc, exc_info=True)
    finally:
        if not conn.is_dead:
            await conn_manager.disconnect(conn, code=WSCloseCode.NORMAL)


# ── Endpoint definitions ──────────────────────────────────────────────────────

@router.websocket("/ws/waiter")
async def ws_waiter(
    websocket: WebSocket,
    token: str = Query(..., description="JWT access token"),
):
    """
    /ws/waiter — WebSocket endpoint for waiters.
    Allowed roles: WAITER, MANAGER, ADMIN.
    """
    from ws_gateway.core.dependencies import get_connection_manager, get_redis_pool, get_settings
    from ws_gateway.components.connection.rate_limiter import RateLimiter
    from ws_gateway.components.auth.strategies import JWTAuthStrategy

    settings = get_settings()
    redis = get_redis_pool()
    strategy = JWTAuthStrategy(redis=redis, allowed_roles={"WAITER", "MANAGER", "ADMIN"})
    conn_manager = get_connection_manager()
    rate_limiter = RateLimiter(redis=redis)

    await _websocket_endpoint(websocket, token, strategy, conn_manager, rate_limiter, settings)


@router.websocket("/ws/kitchen")
async def ws_kitchen(
    websocket: WebSocket,
    token: str = Query(..., description="JWT access token"),
):
    """
    /ws/kitchen — WebSocket endpoint for kitchen staff.
    Allowed roles: KITCHEN, MANAGER, ADMIN.
    """
    from ws_gateway.core.dependencies import get_connection_manager, get_redis_pool, get_settings
    from ws_gateway.components.connection.rate_limiter import RateLimiter
    from ws_gateway.components.auth.strategies import JWTAuthStrategy

    settings = get_settings()
    redis = get_redis_pool()
    strategy = JWTAuthStrategy(redis=redis, allowed_roles={"KITCHEN", "MANAGER", "ADMIN"})
    conn_manager = get_connection_manager()
    rate_limiter = RateLimiter(redis=redis)

    await _websocket_endpoint(websocket, token, strategy, conn_manager, rate_limiter, settings)


@router.websocket("/ws/admin")
async def ws_admin(
    websocket: WebSocket,
    token: str = Query(..., description="JWT access token"),
):
    """
    /ws/admin — WebSocket endpoint for admin/manager Dashboard.
    Allowed roles: ADMIN, MANAGER.
    """
    from ws_gateway.core.dependencies import get_connection_manager, get_redis_pool, get_settings
    from ws_gateway.components.connection.rate_limiter import RateLimiter
    from ws_gateway.components.auth.strategies import JWTAuthStrategy

    settings = get_settings()
    redis = get_redis_pool()
    strategy = JWTAuthStrategy(redis=redis, allowed_roles={"ADMIN", "MANAGER"})
    conn_manager = get_connection_manager()
    rate_limiter = RateLimiter(redis=redis)

    await _websocket_endpoint(websocket, token, strategy, conn_manager, rate_limiter, settings)


@router.websocket("/ws/diner")
async def ws_diner(
    websocket: WebSocket,
    table_token: str = Query(..., description="HMAC Table Token"),
):
    """
    /ws/diner — WebSocket endpoint for diners (pwaMenu).
    Authenticated via Table Token HMAC (no role check).
    """
    from ws_gateway.core.dependencies import get_connection_manager, get_redis_pool, get_settings
    from ws_gateway.components.connection.rate_limiter import RateLimiter
    from ws_gateway.components.auth.strategies import TableTokenAuthStrategy

    settings = get_settings()
    redis = get_redis_pool()
    strategy = TableTokenAuthStrategy(redis=redis)
    conn_manager = get_connection_manager()
    rate_limiter = RateLimiter(redis=redis)

    await _websocket_endpoint(websocket, table_token, strategy, conn_manager, rate_limiter, settings)
