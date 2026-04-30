"""
SecurityHeadersMiddleware — adds security headers to every HTTP response.

Headers applied:
  - Content-Security-Policy
  - X-Frame-Options: DENY (prevent clickjacking)
  - X-Content-Type-Options: nosniff (prevent MIME sniffing)
  - Permissions-Policy (restrict browser features)
  - Referrer-Policy: strict-origin-when-cross-origin

Production-only:
  - Strict-Transport-Security (HSTS) — only when ENVIRONMENT=production
    because HSTS in development breaks local HTTP testing

Registration order in main.py:
  1. app.add_middleware(SecurityHeadersMiddleware)  ← outermost, runs on every response
  2. app.add_middleware(CORSMiddleware, ...)        ← handles preflight before security headers
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from shared.config.settings import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    ASGI middleware that injects security headers into every response.

    CSP is minimal for an API backend (default-src 'self'; script-src 'self').
    Frontend apps have their own, stricter CSP policies.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'"
        )
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Permissions-Policy"] = (
            "geolocation=(), microphone=(), camera=()"
        )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # HSTS only in production — avoids breaking HTTP in local development
        if settings.ENVIRONMENT == "production":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )

        return response
