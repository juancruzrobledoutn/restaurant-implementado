# security-middleware Specification

## Purpose
TBD - created by archiving change auth. Update Purpose after archive.
## Requirements
### Requirement: Security headers middleware

The system SHALL add a `SecurityHeadersMiddleware` that sets security headers on every HTTP response.

#### Scenario: Security headers present in all responses
- **WHEN** any HTTP response is returned from the backend
- **THEN** the response includes headers:
  - `Content-Security-Policy: default-src 'self'; script-src 'self'`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Permissions-Policy: geolocation=(), microphone=(), camera=()`
  - `Referrer-Policy: strict-origin-when-cross-origin`

#### Scenario: HSTS in production only
- **WHEN** the application runs with `ENVIRONMENT=production`
- **THEN** responses include `Strict-Transport-Security: max-age=31536000; includeSubDomains`

#### Scenario: HSTS absent in development
- **WHEN** the application runs with `ENVIRONMENT=development`
- **THEN** responses do NOT include the `Strict-Transport-Security` header

### Requirement: CORS configuration

The system SHALL configure CORS with environment-specific allowed origins. In development, localhost defaults SHALL be used. In production, origins SHALL be loaded from `ALLOWED_ORIGINS` environment variable.

#### Scenario: Development CORS defaults
- **WHEN** the application runs in development mode
- **THEN** CORS allows origins: `http://localhost:5176`, `http://localhost:5177`, `http://localhost:5178`, `http://localhost:8000`, `http://localhost:8001`

#### Scenario: Production CORS from environment
- **WHEN** the application runs in production with `ALLOWED_ORIGINS=https://app.example.com,https://menu.example.com`
- **THEN** CORS allows only those specific origins

#### Scenario: CORS allows credentials
- **WHEN** any CORS configuration is active
- **THEN** `allow_credentials=True` is set (required for HttpOnly cookie refresh token)

#### Scenario: Missing ALLOWED_ORIGINS in production
- **WHEN** the application starts in production without `ALLOWED_ORIGINS` set
- **THEN** `validate_production_secrets()` prevents startup (fail-fast)

### Requirement: Middleware registration order

The system SHALL register middleware in the correct order: SecurityHeadersMiddleware runs on every response (outermost), CORS middleware handles preflight (standard FastAPI), rate limiting via slowapi integrates at the router level.

#### Scenario: Middleware execution order
- **WHEN** a request passes through the middleware stack
- **THEN** SecurityHeadersMiddleware executes after CORS (adding headers to the final response)
- **AND** rate limiting is enforced at the router/endpoint level via slowapi decorators

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

