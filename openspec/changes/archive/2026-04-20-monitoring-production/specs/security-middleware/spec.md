## ADDED Requirements

### Requirement: Request ID middleware injects a unique trace identifier per request
The backend and ws_gateway SHALL include a `RequestIDMiddleware` that generates a `request_id = str(uuid4())` at the start of every request, stores it in a `contextvars.ContextVar`, propagates it to the structured logger, and returns it as `X-Request-ID` response header.

#### Scenario: Every backend response includes X-Request-ID header
- **WHEN** any HTTP request is processed by the backend
- **THEN** the response includes `X-Request-ID: <uuid4>` header

#### Scenario: request_id appears in all log lines for a given request
- **WHEN** the backend processes a request that generates multiple log lines (e.g., auth + DB query + response)
- **THEN** all log lines for that request share the same `request_id` value

#### Scenario: ws_gateway responses include X-Request-ID
- **WHEN** the ws_gateway handles an HTTP request (e.g., health check, catchup endpoint)
- **THEN** the response includes `X-Request-ID: <uuid4>` header

### Requirement: Structured logger includes request context fields automatically
The `get_logger()` function in the backend SHALL be enhanced to read `request_id`, `user_id`, and `tenant_id` from `contextvars.ContextVar` and include them in every log record automatically, without requiring callers to pass them explicitly.

#### Scenario: Authenticated request log includes user_id and tenant_id
- **WHEN** an authenticated request sets `user_id` and `tenant_id` in context vars
- **THEN** every subsequent `logger.info(...)` call within that request includes both fields in the JSON output

#### Scenario: Unauthenticated request log omits auth fields
- **WHEN** a public request does not set `user_id` or `tenant_id`
- **THEN** log lines omit those fields (no `null` values — fields are absent entirely)
