## ADDED Requirements

### Requirement: Independent WebSocket Gateway Service
The system SHALL provide a WebSocket Gateway as a standalone FastAPI service running on port 8001, packaged in its own directory `ws_gateway/` with its own `main.py`, `Dockerfile`, and entry in `devOps/docker-compose.yml`.

The Gateway SHALL NOT hold any SQLAlchemy session or direct database connection. All runtime dependencies SHALL be satisfied via Redis (Pub/Sub + Streams) and in-process state. The Gateway MAY import from `backend/shared/` (config, security helpers, logger) but MUST NOT import from `backend/rest_api/`.

The Gateway SHALL expose the following HTTP routes alongside its WebSocket endpoints:
- `GET /health` — liveness (returns 200 if process is up).
- `GET /health/detailed` — Redis connectivity, consumer group lag, DLQ size, circuit breaker states.
- `GET /ws/metrics` — active connections, messages/sec, worker pool stats (protected; only enabled in `ENVIRONMENT in {"dev","staging"}` or when `WS_METRICS_TOKEN` is configured).

#### Scenario: Gateway runs as separate docker service on port 8001
- **WHEN** `docker-compose up ws_gateway` is executed
- **THEN** the service starts on port 8001, binds to `0.0.0.0`, and responds 200 to `GET /health`
- **AND** the `backend` service on port 8000 continues to operate independently

#### Scenario: Gateway does not require PostgreSQL
- **WHEN** PostgreSQL is unreachable and the Gateway starts
- **THEN** the Gateway starts successfully
- **AND** accepts WebSocket connections (provided Redis is available)

#### Scenario: Gateway requires Redis to start
- **WHEN** Redis is unreachable and the Gateway starts
- **THEN** `/health/detailed` returns 503 with `redis: unreachable`
- **AND** WebSocket handshakes return `1011` after accepting (Redis-dependent initialization failed)

#### Scenario: Gateway lifespan starts components in order
- **WHEN** the Gateway starts
- **THEN** broadcast workers are started first
- **AND** the Redis Pub/Sub subscriber is started next
- **AND** the Redis Streams consumer is started next
- **AND** the heartbeat cleanup task is started last

#### Scenario: Gateway shutdown is graceful
- **WHEN** the Gateway receives SIGTERM
- **THEN** new WebSocket handshakes are rejected with HTTP 503
- **AND** existing connections are closed with code `1001`
- **AND** the worker pool drains pending tasks up to a 5-second timeout
- **AND** pending stream ACKs are flushed before the process exits

---

### Requirement: Four WebSocket Endpoints by Role
The Gateway SHALL expose exactly four WebSocket endpoints, each with role-based authentication and access:

| Endpoint | Auth | Allowed roles |
|----------|------|---------------|
| `/ws/waiter?token=JWT` | JWT | `WAITER`, `MANAGER`, `ADMIN` |
| `/ws/kitchen?token=JWT` | JWT | `KITCHEN`, `MANAGER`, `ADMIN` |
| `/ws/admin?token=JWT` | JWT | `ADMIN`, `MANAGER` |
| `/ws/diner?table_token=TOKEN` | HMAC Table Token | (no role — bound to `session_id`) |

Each endpoint SHALL read the token from the query string and MUST NOT accept tokens in headers (WebSocket handshake does not allow custom headers cross-browser).

#### Scenario: /ws/admin accepts ADMIN role
- **WHEN** a client connects to `/ws/admin?token={valid_admin_jwt}`
- **THEN** the WebSocket handshake succeeds with status 101
- **AND** the connection is registered in the `ConnectionIndex` under the user's `branch_ids`

#### Scenario: /ws/admin rejects KITCHEN role
- **WHEN** a client connects to `/ws/admin?token={valid_kitchen_jwt}`
- **THEN** the handshake is accepted then closed with code `4003`
- **AND** no messages are sent to the client before close

#### Scenario: /ws/diner accepts valid Table Token
- **WHEN** a client connects to `/ws/diner?table_token={valid_table_token}`
- **THEN** the handshake succeeds
- **AND** the connection is bound to `session_id` from the token payload
- **AND** the connection will receive `SESSION_EVENTS` for that session

#### Scenario: Endpoint rejects token in Authorization header
- **WHEN** a client attempts to connect to `/ws/waiter` with `Authorization: Bearer xxx` header but no `token` query param
- **THEN** the connection is closed with code `4001`

---

### Requirement: JWT Authentication Strategy with Periodic Revalidation
The Gateway SHALL provide a `JWTAuthStrategy` that verifies JWT access tokens using `backend/shared/security/auth.verify_jwt_claims()`. The strategy SHALL check the token blacklist in Redis with **fail-closed** policy: if Redis is unreachable during blacklist check, the token SHALL be rejected.

The strategy SHALL revalidate tokens in a background task every `JWT_REVALIDATION_INTERVAL` seconds (default 300). If revalidation fails (expired, blacklisted, signature invalid), the connection SHALL be closed with code `4001`.

#### Scenario: Valid JWT is accepted
- **WHEN** a client presents a JWT with valid signature, non-expired, not blacklisted, with an allowed role
- **THEN** the handshake succeeds
- **AND** the `AuthResult` contains `tenant_id`, `user_id`, `branch_ids`, `roles`, `sector_ids` (if applicable)

#### Scenario: Expired JWT is rejected with 4001
- **WHEN** a client presents a JWT whose `exp` is in the past
- **THEN** the connection is closed with code `4001`

#### Scenario: Blacklisted JWT is rejected
- **WHEN** a client presents a JWT whose `jti` is stored in Redis key `jwt:blacklist:{jti}`
- **THEN** the connection is closed with code `4001`

#### Scenario: Redis unavailable during blacklist check
- **WHEN** a client presents a valid JWT and Redis blacklist check raises `ConnectionError`
- **THEN** the connection is closed with code `4001` (fail-closed)

#### Scenario: JWT expires mid-session
- **WHEN** a valid JWT expires 5 minutes after connection is established
- **AND** the background revalidation task runs after expiration
- **THEN** the connection is closed with code `4001`
- **AND** no further events are delivered to that connection

---

### Requirement: Table Token Authentication Strategy
The Gateway SHALL provide a `TableTokenAuthStrategy` that verifies HMAC-SHA256 Table Tokens using `backend/shared/security/table_token.verify_table_token()`. The strategy SHALL verify HMAC integrity, TTL (3 hours from issuance), and that the referenced `session_id` points to an `OPEN` or `PAYING` session (if the session is `CLOSED`, the connection SHALL be refused with `4001`).

The strategy SHALL revalidate tokens every `TABLE_TOKEN_REVALIDATION_INTERVAL` seconds (default 1800).

#### Scenario: Valid Table Token is accepted for OPEN session
- **WHEN** a diner connects with a Table Token whose session is `OPEN`
- **THEN** the handshake succeeds
- **AND** the connection is bound to `session_id`, `diner_id`, `table_id`, `branch_id`, `tenant_id`

#### Scenario: Table Token for CLOSED session is rejected
- **WHEN** a diner connects with a Table Token whose session has moved to `CLOSED`
- **THEN** the connection is closed with code `4001`

#### Scenario: Tampered Table Token is rejected
- **WHEN** a client presents a Table Token whose HMAC signature does not match the payload
- **THEN** the connection is closed with code `4001`

#### Scenario: Expired Table Token is rejected
- **WHEN** the Table Token's `exp` has passed
- **THEN** the connection is closed with code `4001`

---

### Requirement: Strategy Pattern for Authentication
The Gateway SHALL implement authentication using the Strategy Pattern:
- `AuthStrategy` is the abstract base class with `authenticate(token) -> AuthResult` and `revalidate(auth_result) -> AuthResult`.
- `JWTAuthStrategy`, `TableTokenAuthStrategy`, `CompositeAuthStrategy`, `NullAuthStrategy` are the concrete implementations.
- `CompositeAuthStrategy` SHALL try strategies in order and return the first successful result (chain of responsibility).
- `NullAuthStrategy` SHALL accept any token and produce a synthetic `AuthResult` for testing only; it MUST be rejected by the runtime configuration in non-test environments.

Each WebSocket endpoint SHALL receive its strategy by dependency injection, not hard-coded.

#### Scenario: NullAuthStrategy is rejected in production
- **WHEN** `ENVIRONMENT=production` and a router is configured with `NullAuthStrategy`
- **THEN** the Gateway refuses to start with a clear error message

---

### Requirement: ConnectionManager Composition Pattern
The Gateway SHALL implement `ConnectionManager` as a facade that delegates to five internal modules:
- `ConnectionLifecycle` — accept/disconnect with strict lock ordering to prevent deadlocks.
- `ConnectionIndex` — multi-dimensional indexes: by `user_id`, `branch_id`, `sector_id`, `session_id`.
- `ConnectionBroadcaster` — worker pool with fallback to batch processing.
- `ConnectionCleanup` — periodic sweep (every 60 seconds) of stale connections, dead sockets, and orphaned locks.
- `ConnectionStats` — aggregated metrics (active connections, messages/sec, latency).

`ConnectionManager` SHALL NOT implement connection logic directly; it only orchestrates the five modules. Each module SHALL be independently testable via `ConnectionManagerDependencies` injection.

#### Scenario: ConnectionManager delegates accept to ConnectionLifecycle
- **WHEN** `ConnectionManager.connect(websocket, auth_result)` is called
- **THEN** the call is forwarded to `ConnectionLifecycle.accept()`
- **AND** on success, the connection is registered in `ConnectionIndex`

#### Scenario: Lock ordering prevents deadlock
- **WHEN** two concurrent connects for the same `(tenant_id, branch_id, user_id)` execute
- **THEN** both complete within 2 seconds without deadlock
- **AND** both connections are registered in the index

---

### Requirement: Sharded Locks by (tenant_id, branch_id)
The Gateway SHALL use `asyncio.Lock` instances sharded by `(tenant_id, branch_id)`. A helper `get_tenant_branch_lock(tenant_id, branch_id)` SHALL return the same lock for the same tuple and a distinct lock for different tuples. Locks SHALL be stored in a `WeakValueDictionary` for automatic garbage collection when branches go idle.

Operations within a single branch (connect, disconnect, index update) SHALL be serialized; operations across different `(tenant, branch)` tuples SHALL run concurrently.

#### Scenario: Operations on different branches run concurrently
- **WHEN** two connects for `(tenant=1, branch=1)` and `(tenant=1, branch=2)` execute in parallel
- **THEN** both complete without blocking each other

#### Scenario: Operations on the same branch are serialized
- **WHEN** two connects for `(tenant=1, branch=1)` execute in parallel
- **THEN** they acquire the same lock and execute sequentially

---

### Requirement: Worker Pool for Broadcasting
The Gateway SHALL implement broadcasting with a worker pool of `WS_BROADCAST_WORKERS` (default 10) permanent workers consuming from an `asyncio.Queue` with `maxsize=WS_BROADCAST_QUEUE_SIZE` (default 5000). Each worker SHALL:
1. Dequeue a (connection, message) tuple.
2. Call `websocket.send_text(json.dumps(message))` with a 5-second timeout.
3. On success, record metrics via `BroadcastObserver`.
4. On failure or timeout, mark the connection for cleanup and continue.

If the queue is full or workers are unavailable, the Gateway SHALL fall back to `asyncio.gather(chunks of 50)` batch processing.

#### Scenario: Broadcast to 400 recipients completes within 500ms
- **WHEN** an event with 400 target connections is broadcast
- **THEN** all 400 messages are delivered within 500ms (p95)

#### Scenario: Slow consumer does not block others
- **WHEN** one of the recipients takes 10 seconds to process `send_text`
- **THEN** the worker marks that connection as dead after 5s
- **AND** the remaining 399 recipients receive the event normally

#### Scenario: Queue saturation triggers fallback
- **WHEN** the broadcast queue is full and a new event arrives
- **THEN** the Gateway switches to batch mode for that event
- **AND** a warning is logged

---

### Requirement: Circuit Breaker for Redis Operations
The Gateway SHALL protect all Redis operations with a `CircuitBreaker` class implementing three states: `CLOSED`, `OPEN`, `HALF_OPEN`.
- **CLOSED** → on 5 consecutive failures → `OPEN`.
- **OPEN** → for 30 seconds, all operations return a cached default or raise without hitting Redis → after 30s → `HALF_OPEN`.
- **HALF_OPEN** → one probe operation; on success → `CLOSED`; on failure → `OPEN`.

The circuit breaker SHALL be thread-safe using `threading.Lock` and SHALL expose state via `ConnectionStats` for observability.

Separate `CircuitBreaker` instances SHALL be used for Pub/Sub, Streams, and catch-up Redis operations. Each can be in a different state independently.

#### Scenario: 5 consecutive Redis failures open the circuit
- **WHEN** 5 calls to Redis raise `ConnectionError`
- **THEN** the `CircuitBreaker.state` becomes `OPEN`
- **AND** the 6th call does not hit Redis and returns the fallback

#### Scenario: Circuit recovers after 30 seconds
- **WHEN** the circuit has been `OPEN` for 30 seconds
- **THEN** the state transitions to `HALF_OPEN` on the next `can_execute()` check
- **AND** the next Redis call is attempted

#### Scenario: HALF_OPEN success closes the circuit
- **WHEN** the probe call in `HALF_OPEN` succeeds
- **THEN** the state transitions to `CLOSED`
- **AND** the failure counter is reset to 0

---

### Requirement: Heartbeat Protocol
The Gateway SHALL implement a ping/pong heartbeat:
- Client sends `{"type": "ping"}` every 30 seconds.
- Server responds `{"type": "pong"}` immediately.
- If a connection has no inbound traffic for 60 seconds, the server SHALL close it with code `1011`.
- A `HeartbeatTracker` SHALL update `last_seen` on every inbound message (not only pings).

#### Scenario: Ping receives pong
- **WHEN** the client sends `{"type":"ping"}`
- **THEN** the server responds `{"type":"pong"}` within 100ms

#### Scenario: Connection idle for 60 seconds is closed
- **WHEN** a connection sends no messages for 60 seconds
- **THEN** the server closes the connection with code `1011`
- **AND** the connection is removed from `ConnectionIndex`

#### Scenario: Any inbound message resets the heartbeat timer
- **WHEN** the client sends a non-ping message (e.g., cart action) at second 50
- **THEN** the idle timer resets from that moment
- **AND** the connection is not closed at second 60

---

### Requirement: WebSocket Close Codes
The Gateway SHALL use the following close codes with the documented semantics:

| Code | Meaning | Client should reconnect? |
|------|---------|--------------------------|
| `1000` | Normal closure (logout, shutdown, scheduled disconnect) | No |
| `1001` | Server going away (deploy, graceful shutdown) | Yes |
| `1011` | Server error (transient — Redis failure, idle timeout) | Yes |
| `4001` | Authentication failed or revalidation expired | **No** |
| `4003` | Forbidden — role/branch/sector access denied | **No** |
| `4029` | Rate limited or connection limit exceeded | **No** |

#### Scenario: Code 4001 returned on invalid JWT
- **WHEN** a client presents an invalid JWT
- **THEN** the connection is closed with code `4001`

#### Scenario: Code 4029 returned on connection limit
- **WHEN** a user already has 3 open connections and a 4th is attempted
- **THEN** the 4th is closed with code `4029`

---

### Requirement: Redis Streams Consumer Group for Critical Events
The Gateway SHALL consume the Redis Stream `events:critical` via consumer group `ws_gateway_group`:
1. On startup: `XGROUP CREATE events:critical ws_gateway_group $ MKSTREAM` (idempotent — ignore `BUSYGROUP`).
2. Continuous loop: `XREADGROUP GROUP ws_gateway_group consumer-{uuid} COUNT 50 BLOCK 100 STREAMS events:critical >`.
3. For each message: validate schema → route via `EventRouter` → broadcast → `XACK` + `XDEL`.
4. Every 30 seconds: `XAUTOCLAIM events:critical ws_gateway_group consumer-{uuid} 60000 0-0 COUNT 100` to recover pending messages from dead consumers.
5. If a message's `delivery_count` exceeds `WS_STREAM_MAX_DELIVERIES` (default 3) → move to DLQ via `XADD events:dlq * payload "{...}" reason "{...}"` + `XACK` + `XDEL` from source.

#### Scenario: Event published to stream is delivered to subscribers
- **WHEN** a producer calls `XADD events:critical * event_type SERVICE_CALL_CREATED payload {...}`
- **THEN** within 1 second the Gateway routes the event
- **AND** the target connections receive the payload
- **AND** the message is ACKed and deleted from the stream

#### Scenario: Failed event retries up to max_deliveries then goes to DLQ
- **WHEN** a message's processing throws 3 times consecutively
- **THEN** on the 4th delivery attempt, the message is moved to `events:dlq` with a `reason` field
- **AND** removed from `events:critical`

#### Scenario: Pending messages are reclaimed after consumer crash
- **WHEN** a consumer reads a message but does not ACK before crashing (`idle > 60s`)
- **THEN** the next `XAUTOCLAIM` cycle reclaims the message
- **AND** the new consumer re-processes it

---

### Requirement: Redis Pub/Sub for Best-Effort Events
The Gateway SHALL subscribe to the following Redis Pub/Sub channels for low-latency, best-effort delivery:
- `branch:*:waiters`
- `branch:*:kitchen`
- `branch:*:admin`
- `sector:*:waiters`
- `session:*`

Pub/Sub messages SHALL be processed with the same `EventRouter` but without retries or DLQ — on failure, they are logged and dropped.

#### Scenario: Pub/Sub event is delivered to matching connections
- **WHEN** `PUBLISH branch:42:admin {"event_type":"ENTITY_UPDATED","payload":{...}}` is executed
- **THEN** all `/ws/admin` connections bound to `branch_id=42` receive the event within 200ms

---

### Requirement: EventRouter with Five Categories
The Gateway SHALL route events to connections using five exclusive categories:

| Category | Target connections |
|----------|-------------------|
| `KITCHEN_EVENTS` | Only `/ws/kitchen` connections in the branch |
| `SESSION_EVENTS` | Diner connections bound to the event's `session_id` |
| `ADMIN_ONLY_EVENTS` | Only `/ws/admin` connections in the branch |
| `BRANCH_WIDE_WAITER_EVENTS` | All `/ws/waiter` connections in the branch (sector-agnostic) |
| `SECTOR_EVENTS` | `/ws/waiter` connections whose assigned sectors include `event.sector_id`; plus all `ADMIN` and `MANAGER` connections in the branch |

An event's category SHALL be determined by its `event_type`. A registry maps `event_type → category`. For C-09, the registry is initialized empty (no concrete events yet — they arrive in C-10+); the routing machinery is fully functional and tested with synthetic event types.

Multi-tenant isolation: the router SHALL verify that the event's `tenant_id` matches the recipient's `tenant_id` before sending. Cross-tenant delivery SHALL be prevented even if `branch_id` numerically matches.

#### Scenario: KITCHEN_EVENTS do not reach waiters
- **WHEN** an event of category `KITCHEN_EVENTS` is routed for branch 1
- **THEN** only connections on `/ws/kitchen` with `branch_id=1` receive it
- **AND** connections on `/ws/waiter`, `/ws/admin`, `/ws/diner` do not receive it

#### Scenario: SECTOR_EVENTS filtered by sector for waiters
- **WHEN** an event of category `SECTOR_EVENTS` with `sector_id=5` is routed
- **THEN** waiter connections whose `sector_ids` include 5 receive it
- **AND** waiter connections in sectors other than 5 do not receive it
- **AND** all `ADMIN` and `MANAGER` connections in the branch receive it regardless of sector

#### Scenario: Cross-tenant event is not delivered
- **WHEN** an event with `tenant_id=1` matches a connection with `tenant_id=2` numerically by `branch_id`
- **THEN** the event is NOT delivered to the connection
- **AND** a warning is logged

#### Scenario: Unknown event_type is logged and dropped
- **WHEN** an event with `event_type` absent from the registry arrives
- **THEN** the event is dropped
- **AND** a warning with `event_type` is logged
- **AND** no connection receives it

---

### Requirement: Event Catch-up HTTP Endpoints
The Gateway SHALL expose two HTTP endpoints for event catch-up on the same service (port 8001):

**`GET /ws/catchup?branch_id=&since=&token=`** — for staff (JWT-authenticated):
- Verifies JWT via `verify_jwt_claims()`.
- Verifies `branch_id` is in the user's `branch_ids`.
- Reads from sorted set `catchup:branch:{branch_id}` with `ZRANGEBYSCORE key {since} +inf`.
- Returns events as JSON array.
- If `since` is older than the oldest score in the set → 410 Gone.

**`GET /ws/catchup/session?session_id=&since=&table_token=`** — for diners (Table Token-authenticated):
- Verifies Table Token HMAC.
- Verifies `session_id` matches the token's `session_id`.
- Reads from `catchup:session:{session_id}`.
- Filters events to the whitelist: `ROUND_*`, `CART_*`, `CHECK_*`, `PAYMENT_*`, `TABLE_STATUS_CHANGED`, `PRODUCT_AVAILABILITY_CHANGED`.
- Returns filtered events as JSON array.

The Gateway SHALL populate both sorted sets on every event processed:
- `ZADD catchup:branch:{branch_id} {timestamp_ms} "{event_json}"`
- If event has `session_id`: `ZADD catchup:session:{session_id} {timestamp_ms} "{event_json}"`
- `ZREMRANGEBYRANK key 0 -101` to cap at `WS_CATCHUP_MAX_EVENTS` (default 100).
- `EXPIRE key WS_CATCHUP_TTL_SECONDS` (default 300).

#### Scenario: Staff catch-up returns events since timestamp
- **WHEN** a staff user calls `GET /ws/catchup?branch_id=1&since=1700000000000` with a valid JWT
- **AND** the set `catchup:branch:1` contains 50 events between that timestamp and now
- **THEN** all 50 events are returned as a JSON array ordered by timestamp

#### Scenario: Diner catch-up is filtered to whitelist
- **WHEN** a diner calls `GET /ws/catchup/session?session_id=12&since=1700000000000`
- **AND** the set `catchup:session:12` contains a mix of allowed and staff-only events
- **THEN** only events whose type matches the diner whitelist are returned
- **AND** `ENTITY_*` events (staff-only) are excluded

#### Scenario: Stale since returns 410 Gone
- **WHEN** `since` is older than the oldest event in the set (events aged out of TTL)
- **THEN** the endpoint returns HTTP 410

#### Scenario: Cross-session diner catch-up is forbidden
- **WHEN** a diner with a Table Token for `session_id=5` calls `/ws/catchup/session?session_id=6`
- **THEN** the endpoint returns HTTP 403

#### Scenario: Catch-up sorted set is trimmed to 100 events
- **WHEN** the 101st event is added to `catchup:branch:1`
- **THEN** the oldest event is automatically removed
- **AND** the set contains exactly 100 entries

#### Scenario: Catch-up key expires after 5 minutes of inactivity
- **WHEN** 5 minutes elapse without a new event for branch 1
- **THEN** the key `catchup:branch:1` is deleted by Redis TTL

---

### Requirement: WebSocket Rate Limiting
The Gateway SHALL rate-limit inbound WebSocket messages at **30 messages per `WS_RATE_LIMIT_WINDOW_SECONDS` (default 1) per connection**. The counter SHALL be persisted in Redis at key `ws:ratelimit:{user_or_diner_id}:{device_id}` so that reconnections from the same user/device do not reset the counter.

Exceeding the limit SHALL close the connection with code `4029` and mark the user as abusive at `ws:abusive:{user_or_diner_id}` for 60 seconds, during which new connections from that user SHALL be rejected with `4029`.

Rate limiting SHALL be implemented via a Lua script for atomic increment + expire.

#### Scenario: 31st message in the window closes the connection
- **WHEN** a connection sends 30 messages within 1 second, then a 31st
- **THEN** the 31st message triggers a close with code `4029`

#### Scenario: Reconnection does not reset the rate limit
- **WHEN** a user exceeds the rate limit, reconnects, and immediately sends a message
- **THEN** the new connection is closed with code `4029`
- **AND** the user remains marked as abusive for 60 seconds

#### Scenario: Counter expires after window
- **WHEN** a connection sends 20 messages in the window, then waits 2 seconds
- **THEN** the counter has expired
- **AND** 30 new messages are allowed

---

### Requirement: Connection Limits per User and per Instance
The Gateway SHALL enforce:
- Maximum `WS_MAX_CONNECTIONS_PER_USER` (default 3) connections per `user_id` (multi-tab) or per `diner_id` + `device_id` combination.
- Maximum `WS_MAX_CONNECTIONS` (default 1000) total active connections per Gateway instance.

Exceeding either limit SHALL close the connection with code `4029`.

#### Scenario: 4th connection for the same user is rejected
- **WHEN** a user has 3 active connections and attempts a 4th
- **THEN** the 4th is closed with code `4029`
- **AND** the 3 existing connections remain open

#### Scenario: 1001st instance connection is rejected
- **WHEN** the instance has 1000 active connections and a new handshake arrives
- **THEN** the new handshake is closed with code `4029`

---

### Requirement: Origin Validation on Handshake
The Gateway SHALL validate the `Origin` header during the WebSocket handshake against `WS_ALLOWED_ORIGINS` (comma-separated list). If the header is missing or not matched, the handshake SHALL be rejected with HTTP 403.

In non-production environments, defaults SHALL include `http://localhost:5176`, `http://localhost:5177`, `http://localhost:5178`. In production, `WS_ALLOWED_ORIGINS` MUST be explicitly configured; the Gateway SHALL refuse to start if it is empty.

`WS_ALLOW_NO_ORIGIN` (default `false`) MAY be set to `true` to accept connections without an `Origin` header (for server-to-server tooling).

#### Scenario: Unknown Origin is rejected
- **WHEN** a handshake arrives with `Origin: https://evil.com`
- **AND** that origin is not in `WS_ALLOWED_ORIGINS`
- **THEN** the handshake returns HTTP 403

#### Scenario: No Origin with WS_ALLOW_NO_ORIGIN=false is rejected
- **WHEN** `WS_ALLOW_NO_ORIGIN=false` and a handshake arrives without an `Origin` header
- **THEN** the handshake returns HTTP 403

#### Scenario: Gateway refuses to start in production without WS_ALLOWED_ORIGINS
- **WHEN** `ENVIRONMENT=production` and `WS_ALLOWED_ORIGINS` is empty
- **THEN** the Gateway exits immediately with a configuration error

---

### Requirement: Health and Metrics Endpoints
The Gateway SHALL expose three non-WebSocket HTTP endpoints:

- `GET /health` → 200 with `{"status":"ok"}` if the process is alive.
- `GET /health/detailed` → 200 if Redis is reachable and consumer group exists; 503 otherwise. Response includes `redis_status`, `consumer_group_lag`, `dlq_size`, `circuit_breakers` (per-resource state), `active_connections`.
- `GET /ws/metrics` → gated by `ENVIRONMENT in {"dev","staging"}` OR by `WS_METRICS_TOKEN` query parameter. Returns active connections, messages/sec, worker pool stats, rate-limit counters summary.

#### Scenario: /health returns 200 on liveness
- **WHEN** the Gateway process is running
- **THEN** `GET /health` returns 200 with `{"status":"ok"}`

#### Scenario: /health/detailed reports Redis failure
- **WHEN** Redis is unreachable
- **THEN** `GET /health/detailed` returns 503
- **AND** the response body includes `"redis_status":"unreachable"`

#### Scenario: /ws/metrics is gated in production
- **WHEN** `ENVIRONMENT=production` and no `WS_METRICS_TOKEN` is provided
- **THEN** `GET /ws/metrics` returns 404

---

### Requirement: Multi-Tenant Isolation
The Gateway SHALL guarantee that no connection receives events from a tenant other than its own, even when `branch_id` values numerically collide between tenants.

Every event routed SHALL carry `tenant_id` in its payload. Every connection SHALL have `tenant_id` in its `AuthResult`. The `EventRouter` SHALL filter by `tenant_id` as the first check, before any branch/sector/session filter.

#### Scenario: Event with tenant_id=1 is not sent to connection with tenant_id=2
- **WHEN** an event with `tenant_id=1, branch_id=1` is broadcast
- **AND** a connection exists with `tenant_id=2, branch_id=1`
- **THEN** the connection does NOT receive the event

#### Scenario: Connection index isolates tenants
- **WHEN** `ConnectionIndex.get_connections_in_branch(tenant_id=1, branch_id=1)` is called
- **THEN** it returns only connections whose `tenant_id=1`
- **AND** it does not return connections from `tenant_id=2` even if `branch_id=1`
