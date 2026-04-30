"""
RequestIDMiddleware — generates and propagates a unique request ID per request.

Design decisions (from design.md D4):
  - Uses ContextVar (NOT thread-local, NOT request.state) for async safety.
  - Each incoming request gets a uuid4() request ID.
  - If the client sends X-Request-ID, it is accepted and propagated as-is
    (allows tracing across service boundaries and correlation with frontend logs).
  - The request ID is stored in a ContextVar so it is accessible anywhere
    in the async call stack without passing it explicitly.
  - The request ID is added to every response as X-Request-ID header.

Usage:
    from shared.middleware.request_id import RequestIDMiddleware, request_id_ctx

    # In main.py:
    app.add_middleware(RequestIDMiddleware)

    # Anywhere in the request lifecycle:
    from shared.middleware.request_id import request_id_ctx
    rid = request_id_ctx.get()  # returns "" if outside a request context
"""
from __future__ import annotations

import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# ContextVar that holds the request ID for the current async task.
# Default is "" so callers can always call .get() safely without a default arg.
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")

# ContextVars for user_id and tenant_id — populated by auth dependencies when
# a user is authenticated. The logger reads these to enrich log records.
user_id_ctx: ContextVar[str] = ContextVar("user_id", default="")
tenant_id_ctx: ContextVar[str] = ContextVar("tenant_id", default="")


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    ASGI middleware that assigns a unique ID to every HTTP request.

    Lifecycle:
      1. Read X-Request-ID from incoming headers (accept client-provided IDs).
      2. If not present, generate a new uuid4().
      3. Store in request_id_ctx ContextVar.
      4. Forward the request down the ASGI stack.
      5. Add X-Request-ID to the response headers.

    The ContextVar approach is async-safe: each asyncio Task inherits a copy
    of the context at Task creation time, so concurrent requests never share
    the same ContextVar state.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # Accept client-provided X-Request-ID or generate a fresh one
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())

        # Set in ContextVar — visible to all code in this async call chain
        token = request_id_ctx.set(request_id)
        try:
            response = await call_next(request)
        finally:
            # Reset the ContextVar to its previous state (clean up)
            request_id_ctx.reset(token)

        # Propagate the request ID to the client
        response.headers["X-Request-ID"] = request_id
        return response
