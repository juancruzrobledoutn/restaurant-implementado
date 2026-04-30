## ADDED Requirements

### Requirement: IP-based rate limiting on login endpoint

The system SHALL rate-limit `POST /api/auth/login` at 5 requests per 60-second window per IP address using slowapi middleware.

#### Scenario: Under rate limit
- **WHEN** fewer than 5 login requests are sent from the same IP within 60 seconds
- **THEN** all requests are processed normally

#### Scenario: Rate limit exceeded by IP
- **WHEN** a 6th login request is sent from the same IP within a 60-second window
- **THEN** the system returns HTTP 429 with a `Retry-After` header indicating when the window resets

#### Scenario: Different IPs are independent
- **WHEN** 5 login requests are sent from IP-A and then 1 from IP-B within the same window
- **THEN** the request from IP-B is processed normally (separate counters)

### Requirement: Email-based rate limiting on login endpoint

The system SHALL rate-limit login attempts at 5 per 60-second window per email address using a Redis Lua atomic script. This is independent of and in addition to IP-based rate limiting.

#### Scenario: Under email rate limit
- **WHEN** fewer than 5 login requests are sent for the same email within 60 seconds (from any IPs)
- **THEN** all requests are processed normally

#### Scenario: Email rate limit exceeded
- **WHEN** a 6th login request is sent for the same email within a 60-second window (even from different IPs)
- **THEN** the system returns HTTP 429 with `{"detail": "Too many login attempts for this account"}`

#### Scenario: Lua script atomicity
- **WHEN** multiple concurrent login requests arrive for the same email
- **THEN** the Redis Lua script atomically increments and checks the counter (no race conditions)

### Requirement: Rate limiting fail-closed policy

The system SHALL reject login requests if Redis is unavailable for rate limit checks. Security over availability: if we cannot verify the rate limit, we deny the request.

#### Scenario: Redis unavailable during rate limit check
- **WHEN** a login request arrives but Redis is unreachable
- **THEN** the system returns HTTP 503 with `{"detail": "Service temporarily unavailable"}`

#### Scenario: Redis recovers
- **WHEN** Redis becomes available again after an outage
- **THEN** rate limiting resumes normally with fresh counters (old windows expired during downtime)

### Requirement: Rate limiting on refresh endpoint

The system SHALL rate-limit `POST /api/auth/refresh` at 5 requests per 60-second window per IP address using slowapi.

#### Scenario: Refresh rate limit exceeded
- **WHEN** a 6th refresh request is sent from the same IP within a 60-second window
- **THEN** the system returns HTTP 429
