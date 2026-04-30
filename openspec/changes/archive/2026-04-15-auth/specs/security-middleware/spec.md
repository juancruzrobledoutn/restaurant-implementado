## ADDED Requirements

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
