"""
Centralized application settings using Pydantic Settings.

All configuration is loaded from environment variables or a .env file.
Never hardcode secrets — use environment variables in production.

Call validate_production_secrets() at app startup when ENVIRONMENT=production.
It will raise ValueError and prevent startup if any security config is weak.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database — asyncpg for the app, Alembic will convert to psycopg automatically
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/menu_ops"

    # Redis — port 6380 to avoid conflicts with local Redis on 6379
    REDIS_URL: str = "redis://localhost:6380"

    # Auth secrets
    # WARNING: change these in production. Never commit real secrets.
    JWT_SECRET: str = "dev-jwt-secret-change-in-production-min-32"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_TTL: int = 900        # 15 minutes in seconds
    REFRESH_TOKEN_TTL: int = 604800    # 7 days in seconds

    # Table token for pwaMenu diners (C-08) — MUST be different from JWT_SECRET
    TABLE_TOKEN_SECRET: str = "dev-table-secret-change-in-production-min-32chars"
    TABLE_TOKEN_TTL_SECONDS: int = 10800  # 3 hours

    # Cookie settings
    COOKIE_SECURE: bool = False        # True in production (HTTPS only)
    COOKIE_SAMESITE: str = "lax"
    COOKIE_DOMAIN: str | None = None   # None = current domain

    # CORS
    ALLOWED_ORIGINS: str = ""          # Comma-separated list in production

    # Rate limiting
    LOGIN_RATE_LIMIT: int = 5          # Max attempts per window
    LOGIN_RATE_WINDOW: int = 60        # Window in seconds

    # Runtime environment
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # ── Push Notifications (C-13) ────────────────────────────────────────────
    # Generate with: vapid --gen (or: python -c "from py_vapid import Vapid; Vapid().generate_keys()")
    # NEVER commit real keys — these are placeholders.
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_CONTACT_EMAIL: str = ""

    # ── WebSocket Gateway (C-09) ──────────────────────────────────────────────
    WS_HOST: str = "0.0.0.0"
    WS_PORT: int = 8001
    WS_MAX_CONNECTIONS: int = 1000
    WS_MAX_CONNECTIONS_PER_USER: int = 3
    WS_HEARTBEAT_INTERVAL: int = 30       # seconds
    WS_HEARTBEAT_TIMEOUT: int = 60        # seconds
    WS_RATE_LIMIT_PER_WINDOW: int = 30    # messages per window
    WS_RATE_LIMIT_WINDOW_SECONDS: int = 1
    WS_CATCHUP_TTL_SECONDS: int = 300     # 5 minutes
    WS_CATCHUP_MAX_EVENTS: int = 100
    WS_BROADCAST_WORKERS: int = 10
    WS_BROADCAST_QUEUE_SIZE: int = 5000
    WS_STREAM_CRITICAL: str = "events:critical"
    WS_STREAM_GROUP: str = "ws_gateway_group"
    WS_STREAM_DLQ: str = "events:dlq"
    WS_STREAM_MAX_DELIVERIES: int = 3
    WS_ALLOWED_ORIGINS: str = ""          # Comma-separated list; empty = use DEFAULT_CORS_ORIGINS in dev
    WS_ALLOW_NO_ORIGIN: bool = False      # Allow connections without Origin header (server-to-server)
    WS_METRICS_TOKEN: str = ""            # If set, protects /ws/metrics in production

    # ── Outbox worker (C-10) ──────────────────────────────────────────────────
    # The outbox worker runs in-process inside rest_api and publishes pending
    # OutboxEvent rows to Redis. First real producers: ROUND_SUBMITTED, ROUND_READY.
    OUTBOX_WORKER_INTERVAL_SECONDS: int = 2    # How often to poll for pending events
    OUTBOX_BATCH_SIZE: int = 50                # Max rows processed per poll
    OUTBOX_MAX_RETRIES: int = 3                # Reserved for future retry-with-backoff logic

    # ── MercadoPago (C-12) ───────────────────────────────────────────────────
    # NEVER commit real credentials — these are placeholders for local dev.
    # Startup validation: if ENVIRONMENT=production and any of these are empty,
    # validate_production_secrets() raises ValueError and prevents boot.
    MERCADOPAGO_ACCESS_TOKEN: str = ""
    MERCADOPAGO_PUBLIC_KEY: str = ""
    MERCADOPAGO_WEBHOOK_SECRET: str = "dev-mp-webhook-secret-change-in-production"

    # ── Customer Loyalty (C-19) ──────────────────────────────────────────────
    # Feature flags — env var simple, no external flag service for MVP.
    # Set to False to preserve pre-C-19 behavior (customer_id = NULL on join).
    ENABLE_CUSTOMER_TRACKING: bool = True
    # UI feature flags for split methods (split UI beyond equal_split)
    ENABLE_SPLIT_BY_CONSUMPTION: bool = False
    ENABLE_SPLIT_CUSTOM: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


def validate_production_secrets(settings: "Settings") -> None:
    """
    Validate critical secrets for production. Fail-fast if any check fails.

    Call at application startup when ENVIRONMENT=production.
    Raises ValueError with a descriptive message if any validation fails.
    """
    errors: list[str] = []

    if len(settings.JWT_SECRET) < 32:
        errors.append(
            f"JWT_SECRET must be at least 32 characters (current: {len(settings.JWT_SECRET)})"
        )
    if settings.JWT_SECRET == "dev-secret" or "dev-jwt-secret" in settings.JWT_SECRET:
        errors.append("JWT_SECRET must not use the default development value")

    # Table token secret validation (C-08)
    if len(settings.TABLE_TOKEN_SECRET) < 32:
        errors.append(
            f"TABLE_TOKEN_SECRET must be at least 32 characters (current: {len(settings.TABLE_TOKEN_SECRET)})"
        )
    if "dev-table-secret" in settings.TABLE_TOKEN_SECRET:
        errors.append("TABLE_TOKEN_SECRET must not use the default development value")

    if not settings.COOKIE_SECURE:
        errors.append("COOKIE_SECURE must be True in production")

    if settings.DEBUG:
        errors.append("DEBUG must be False in production")

    if not settings.ALLOWED_ORIGINS:
        errors.append("ALLOWED_ORIGINS must be set in production")

    # WebSocket Gateway (C-09)
    if not settings.WS_ALLOWED_ORIGINS:
        errors.append(
            "WS_ALLOWED_ORIGINS must be set in production (comma-separated list of allowed origins)"
        )

    # MercadoPago (C-12) — fail-closed if credentials missing in production
    if not settings.MERCADOPAGO_ACCESS_TOKEN:
        errors.append("MERCADOPAGO_ACCESS_TOKEN must be set in production")
    if not settings.MERCADOPAGO_WEBHOOK_SECRET or "dev-mp-webhook-secret" in settings.MERCADOPAGO_WEBHOOK_SECRET:
        errors.append("MERCADOPAGO_WEBHOOK_SECRET must be set to a real secret in production")

    if errors:
        raise ValueError(
            "Production security validation failed:\n" + "\n".join(f"  - {e}" for e in errors)
        )


settings = Settings()
