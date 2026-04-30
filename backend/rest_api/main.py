"""
Integrador REST API — FastAPI application entry point.

Middleware stack (outermost first — last added = outermost in ASGI):
  1. SecurityHeadersMiddleware  — adds security headers to every response
  2. CORSMiddleware             — handles CORS preflight and headers
  Rate limiting via slowapi is applied at the endpoint level.

Routers:
  /api/health  — health check (Docker, CI, load balancers)
  /api/auth    — authentication (login, refresh, logout, me, 2fa)

Startup:
  - validate_production_secrets() if ENVIRONMENT=production
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from prometheus_fastapi_instrumentator import Instrumentator

from shared.config.logging import get_logger
from shared.config.settings import settings, validate_production_secrets
from shared.middleware.request_id import RequestIDMiddleware
from rest_api.core.limiter import limiter
from rest_api.core.middlewares import SecurityHeadersMiddleware
from rest_api.routers.auth import router as auth_router
from rest_api.routers.admin_menu import router as admin_menu_router
from rest_api.routers.public_menu import router as public_menu_router
from rest_api.routers.ingredients import router as ingredients_router
from rest_api.routers.recipes import router as recipes_router
from rest_api.routers.catalogs import (
    cooking_methods_router,
    flavor_profiles_router,
    texture_profiles_router,
    cuisine_types_router,
)
from rest_api.routers.admin_allergens import router as admin_allergens_router
from rest_api.routers.admin_sectors import router as admin_sectors_router
from rest_api.routers.public_branches import router as public_branches_router

# C-08: table sessions, waiter, staff, public join, diner
from rest_api.routers.waiter_tables import router as waiter_tables_router
from rest_api.routers.staff_tables import router as staff_tables_router
from rest_api.routers.public_tables import router as public_tables_router
from rest_api.routers.diner_session import router as diner_session_router

# C-13: staff management, waiter assignments, promotions, push notifications
from rest_api.routers.admin_staff import router as admin_staff_router
from rest_api.routers.admin_waiter_assignments import router as admin_waiter_assignments_router
from rest_api.routers.admin_promotions import router as admin_promotions_router
from rest_api.routers.waiter_assignments import router as waiter_assignments_router
from rest_api.routers.waiter_notifications import router as waiter_notifications_router

# C-10: rounds — diner / waiter / admin / kitchen endpoints + outbox worker lifespan
from rest_api.routers.diner_rounds import router as diner_rounds_router
from rest_api.routers.waiter_rounds import router as waiter_rounds_router
from rest_api.routers.admin_rounds import router as admin_rounds_router
from rest_api.routers.kitchen_rounds import router as kitchen_rounds_router
from rest_api.services.domain.outbox_worker import start_worker, stop_worker

# C-11: kitchen tickets, service calls, and the compact waiter menu
from rest_api.routers.kitchen_tickets import router as kitchen_tickets_router
from rest_api.routers.waiter_service_calls import router as waiter_service_calls_router
from rest_api.routers.diner_service_call import router as diner_service_call_router
from rest_api.routers.waiter_menu import router as waiter_menu_router

# C-12: billing — check request, FIFO allocation, MercadoPago, manual payments
from rest_api.routers.billing import router as billing_router

# C-19: customer loyalty — device tracking, opt-in GDPR, visit history
from rest_api.routers.customer import router as customer_router

# C-16: sales reporting + check receipt
from rest_api.routers.admin_sales import router as admin_sales_router
from rest_api.routers.admin_checks import router as admin_checks_router

# C-26: admin billing — checks listing + payments listing (ADMIN/MANAGER)
from rest_api.routers.admin_billing import router as admin_billing_router

logger = get_logger(__name__)

# ── CORS origins ───────────────────────────────────────────────────────────────
_DEV_ORIGINS = [
    "http://localhost:5176",  # pwaMenu
    "http://localhost:5177",  # Dashboard
    "http://localhost:5178",  # pwaWaiter
    "http://localhost:8000",  # backend (health checks, etc.)
    "http://localhost:8001",  # ws_gateway
]


def _get_allowed_origins() -> list[str]:
    """Return CORS origins from environment or dev defaults."""
    if settings.ENVIRONMENT == "production" and settings.ALLOWED_ORIGINS:
        return [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
    return _DEV_ORIGINS


# ── App factory ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Integrador API",
    version="0.1.0",
    description="Multi-tenant restaurant management SaaS — Buen Sabor",
)

# Attach limiter to app state (required by slowapi)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Middleware registration ────────────────────────────────────────────────────
# Order matters: last added = outermost in ASGI stack (runs first on request, last on response).
#
# Execution order (outermost first):
#   1. RequestIDMiddleware  — assigns request ID before any other processing
#   2. SecurityHeadersMiddleware — adds security headers to every response
#   3. CORSMiddleware        — handles CORS preflight and headers

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Table-Token", "Idempotency-Key", "X-Request-ID"],
)

app.add_middleware(SecurityHeadersMiddleware)

# RequestIDMiddleware MUST be registered last (outermost) so the request_id
# ContextVar is set before any other middleware or handler reads it.
app.add_middleware(RequestIDMiddleware)

# ── Production validation ──────────────────────────────────────────────────────


@app.on_event("startup")
async def on_startup() -> None:
    """Run startup checks. Fail-fast in production if secrets are weak."""
    if settings.ENVIRONMENT == "production":
        validate_production_secrets(settings)
        logger.info("Production secrets validated successfully")
    else:
        logger.info("Skipping production secret validation (ENVIRONMENT=%s)", settings.ENVIRONMENT)

    # C-10: outbox worker — publishes pending OutboxEvent rows to Redis.
    # Wrapped to tolerate a worker-start failure without killing the REST API.
    if settings.ENVIRONMENT != "test":
        try:
            start_worker(app)
        except Exception as exc:  # noqa: BLE001
            logger.error("outbox_worker.start_failed: %r — REST API continues", exc)


@app.on_event("shutdown")
async def on_shutdown() -> None:
    """Graceful shutdown — drain the outbox worker."""
    if settings.ENVIRONMENT != "test":
        try:
            await stop_worker(app, timeout=10.0)
        except Exception as exc:  # noqa: BLE001
            logger.warning("outbox_worker.stop_failed: %r", exc)


# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(auth_router, prefix="/api/auth")

# C-04: menu catalog (admin CRUD + public menu)
app.include_router(admin_menu_router, prefix="/api/admin")
app.include_router(public_menu_router, prefix="/api/public")

# C-06: ingredient hierarchy, recipes, and catalog lookups
app.include_router(ingredients_router, prefix="/api/admin/ingredients")
app.include_router(recipes_router, prefix="/api/recipes")
app.include_router(cooking_methods_router, prefix="/api/admin/cooking-methods")
app.include_router(flavor_profiles_router, prefix="/api/admin/flavor-profiles")
app.include_router(texture_profiles_router, prefix="/api/admin/texture-profiles")
app.include_router(cuisine_types_router, prefix="/api/admin/cuisine-types")

# C-05: allergen catalog (admin CRUD + public menu allergens)
app.include_router(admin_allergens_router, prefix="/api/admin")

# C-07: sectors, tables, and waiter assignments (admin) + public branch listing
app.include_router(admin_sectors_router, prefix="/api/admin")
app.include_router(public_branches_router, prefix="/api/public")

# C-08: table sessions
app.include_router(waiter_tables_router, prefix="/api/waiter")   # POST /api/waiter/tables/{id}/activate etc.
app.include_router(staff_tables_router, prefix="/api")           # GET /api/tables/{id}/session etc.
app.include_router(public_tables_router, prefix="/api/public")   # POST /api/public/tables/code/{code}/join
app.include_router(diner_session_router)                         # GET /api/diner/session (prefix built-in)

# C-13: staff management
app.include_router(admin_staff_router, prefix="/api/admin")
app.include_router(admin_waiter_assignments_router, prefix="/api/admin")
app.include_router(admin_promotions_router, prefix="/api/admin")
app.include_router(waiter_assignments_router, prefix="/api/waiter")
app.include_router(waiter_notifications_router, prefix="/api/waiter")

# C-10: rounds — 10 endpoints across 4 role-scoped routers
app.include_router(diner_rounds_router, prefix="/api")             # POST /api/diner/rounds, GET /api/diner/rounds
app.include_router(waiter_rounds_router, prefix="/api/waiter")     # session-rounds, confirm, serve, void, list
app.include_router(admin_rounds_router, prefix="/api/admin")       # submit / cancel
app.include_router(kitchen_rounds_router, prefix="/api/kitchen")   # list + status updates

# C-11: kitchen tickets + service calls + waiter compact menu
app.include_router(kitchen_tickets_router, prefix="/api/kitchen")          # GET/PATCH /api/kitchen/tickets
app.include_router(waiter_service_calls_router, prefix="/api/waiter")     # GET/PATCH /api/waiter/service-calls
app.include_router(diner_service_call_router, prefix="/api")              # POST /api/diner/service-call
app.include_router(waiter_menu_router, prefix="/api/waiter")              # GET /api/waiter/branches/{id}/menu

# C-12: billing — check request, FIFO payments, MercadoPago
app.include_router(billing_router, prefix="/api/billing")                  # POST /api/billing/check/request etc.

# C-19: customer loyalty — device tracking, opt-in GDPR, profile, history
app.include_router(customer_router, prefix="/api/customer")                # GET/POST /api/customer/*

# C-16: sales reporting + check receipt (admin-only)
app.include_router(admin_sales_router, prefix="/api/admin")                # GET /api/admin/sales/*
app.include_router(admin_checks_router, prefix="/api/admin")               # GET /api/admin/checks/{id}/receipt

# C-26: admin billing listing
app.include_router(admin_billing_router, prefix="/api/admin")              # GET /api/admin/billing/checks, /payments

# C-28: dashboard settings — branch settings + tenant settings
from rest_api.routers.admin_branches import router as admin_branches_router
from rest_api.routers.admin_tenants import router as admin_tenants_router

app.include_router(admin_branches_router, prefix="/api/admin")  # GET|PATCH /api/admin/branches/{id}/settings, /api/admin/branches/{id}
app.include_router(admin_tenants_router, prefix="/api/admin")   # GET|PATCH /api/admin/tenants/me


@app.get("/api/health", tags=["system"])
def health() -> dict:
    """Health check endpoint — returns app status and version."""
    return {"status": "ok", "version": "0.1.0"}


# ── Prometheus Metrics ─────────────────────────────────────────────────────────
# Expose /metrics endpoint for Prometheus scraping (C-23: monitoring-production).
# prometheus-fastapi-instrumentator automatically tracks:
#   - http_requests_total (counter) — by method, handler, status
#   - http_request_duration_seconds (histogram) — latency percentiles
#   - http_requests_in_progress (gauge) — concurrent requests
#
# Must be called AFTER all routers are registered so the instrumentator
# covers all endpoints, including the /api/health route above.
Instrumentator(
    should_group_status_codes=False,
    should_ignore_untemplated=True,
    should_respect_env_var=False,
    excluded_handlers=["/metrics"],
).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
