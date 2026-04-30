"""
WebSocket Gateway — centralized constants.

All numeric limits, intervals, Redis key patterns, and close codes live here.
Import from this module; never hardcode these values in component code.
"""
from enum import IntEnum


# ── WebSocket Close Codes ─────────────────────────────────────────────────────

class WSCloseCode(IntEnum):
    """Standard and custom WS close codes used by this Gateway.

    4xxx codes signal "do not reconnect automatically" to clients.
    1001/1006/1011 are transient — clients should retry with backoff.
    """
    NORMAL = 1000          # Graceful close (logout, server shutdown)
    GOING_AWAY = 1001      # Server going away — reconnect allowed
    SERVER_ERROR = 1011    # Internal error — reconnect allowed
    AUTH_FAILED = 4001     # Auth failed or token revalidation failed — no reconnect
    FORBIDDEN = 4003       # Role/branch/sector mismatch — no reconnect
    RATE_LIMITED = 4029    # Rate limit or connection limit exceeded — no reconnect


# ── Timing Intervals (seconds) ────────────────────────────────────────────────

HEARTBEAT_INTERVAL: int = 30          # Client must send ping every N seconds
HEARTBEAT_TIMEOUT: int = 60           # Close connection if no message in N seconds
JWT_REVALIDATION_INTERVAL: int = 300  # Re-check JWT blacklist every 5 min
TABLE_TOKEN_REVALIDATION_INTERVAL: int = 1800  # Re-verify table token every 30 min
CLEANUP_INTERVAL: int = 60            # Background cleanup sweep interval


# ── Connection Limits ─────────────────────────────────────────────────────────

MAX_CONNECTIONS: int = 1000           # Hard limit — total active connections per instance
MAX_CONNECTIONS_PER_USER: int = 3     # Max tabs / clients per user_id


# ── Broadcast Worker Pool ─────────────────────────────────────────────────────

BROADCAST_WORKERS: int = 10           # Permanent background workers
BROADCAST_QUEUE_SIZE: int = 5000      # asyncio.Queue maxsize (backpressure)
BROADCAST_SEND_TIMEOUT: float = 5.0   # seconds before marking connection dead
BROADCAST_BATCH_SIZE: int = 50        # Fallback batch size when queue full


# ── Event Catch-up ────────────────────────────────────────────────────────────

CATCHUP_TTL: int = 300                # Sorted set TTL (seconds) = 5 minutes
CATCHUP_MAX_EVENTS: int = 100         # Max events stored per branch/session key


# ── Redis Pub/Sub Channel Patterns ────────────────────────────────────────────

CHANNEL_BRANCH_WAITERS: str = "branch:{}:waiters"
CHANNEL_BRANCH_KITCHEN: str = "branch:{}:kitchen"
CHANNEL_BRANCH_ADMIN: str = "branch:{}:admin"
CHANNEL_SECTOR_WAITERS: str = "sector:{}:waiters"
CHANNEL_SESSION: str = "session:{}"

# Pattern subscriptions (psubscribe)
PUBSUB_PATTERNS: list[str] = [
    "branch:*:waiters",
    "branch:*:kitchen",
    "branch:*:admin",
    "sector:*:waiters",
    "session:*",
]


# ── Redis Streams ─────────────────────────────────────────────────────────────

STREAM_CRITICAL: str = "events:critical"   # Main stream for outbox events
STREAM_GROUP: str = "ws_gateway_group"     # Consumer group name
STREAM_DLQ: str = "events:dlq"             # Dead letter queue
STREAM_MAX_DELIVERIES: int = 3             # Max retries before DLQ
STREAM_READ_COUNT: int = 50                # Messages per XREADGROUP call
STREAM_BLOCK_MS: int = 100                 # BLOCK timeout in ms
STREAM_AUTOCLAIM_INTERVAL: float = 30.0   # Seconds between XAUTOCLAIM sweeps
STREAM_AUTOCLAIM_MIN_IDLE_MS: int = 60000 # Min idle ms before claiming (1 min)
STREAM_AUTOCLAIM_COUNT: int = 100          # Max messages per XAUTOCLAIM call


# ── Rate Limiting ─────────────────────────────────────────────────────────────

RATE_LIMIT_MSGS: int = 30     # Max messages per window per connection
RATE_LIMIT_WINDOW: int = 1    # Window duration in seconds

# Redis key patterns for rate limiting
RATE_LIMIT_KEY: str = "ws:ratelimit:{}:{}"   # ws:ratelimit:{user_id}:{device_id}
ABUSIVE_KEY: str = "ws:abusive:{}"           # ws:abusive:{user_id}
ABUSIVE_TTL: int = 60                         # seconds


# ── Redis Catch-up Key Patterns ───────────────────────────────────────────────

CATCHUP_BRANCH_KEY: str = "catchup:branch:{}"    # sorted set for branch events
CATCHUP_SESSION_KEY: str = "catchup:session:{}"  # sorted set for session events


# ── JWT Blacklist Key Pattern ─────────────────────────────────────────────────

JWT_BLACKLIST_KEY: str = "jwt:blacklist:{}"   # jwt:blacklist:{jti}
# Note: auth.py uses "blacklist:{jti}" without prefix — kept consistent with shared/


# ── CORS / Origin Defaults ────────────────────────────────────────────────────

DEFAULT_CORS_ORIGINS: list[str] = [
    "http://localhost:5176",   # pwaMenu
    "http://localhost:5177",   # Dashboard
    "http://localhost:5178",   # pwaWaiter
    "http://127.0.0.1:5176",
    "http://127.0.0.1:5177",
    "http://127.0.0.1:5178",
]


# ── Diner-visible event whitelist (for catch-up session endpoint) ─────────────

DINER_EVENT_WHITELIST_PREFIXES: tuple[str, ...] = (
    "ROUND_",
    "CART_",
    "CHECK_",
    "PAYMENT_",
    "TABLE_STATUS_CHANGED",
    "PRODUCT_AVAILABILITY_CHANGED",
)
