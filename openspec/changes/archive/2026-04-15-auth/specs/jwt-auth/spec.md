## ADDED Requirements

### Requirement: User login with JWT issuance

The system SHALL authenticate users via email and password, returning a JWT access token in the response body and setting a refresh token as an HttpOnly cookie. The access token SHALL contain claims: `sub` (user ID), `tenant_id`, `branch_ids` (array), `roles` (array), `email`, `jti` (unique token ID), `type` ("access"), `iss` (issuer), `aud` (audience), `iat`, `exp`. The access token SHALL expire after 15 minutes. Login SHALL only succeed for users with `is_active=True`.

#### Scenario: Successful login with valid credentials
- **WHEN** a POST request is sent to `/api/auth/login` with valid email and password
- **THEN** the system returns HTTP 200 with `access_token`, `token_type: "bearer"`, and a `user` object containing `id`, `email`, `full_name`, `tenant_id`, `branch_ids`, `roles`
- **AND** a `refresh_token` HttpOnly cookie is set with `SameSite=lax`, `Secure=true` (production), `path=/api/auth`, `max-age=604800` (7 days)

#### Scenario: Login with invalid email
- **WHEN** a POST request is sent to `/api/auth/login` with a non-existent email
- **THEN** the system returns HTTP 401 with `{"detail": "Invalid credentials"}`
- **AND** the response timing is indistinguishable from an invalid password (constant-time comparison to prevent user enumeration)

#### Scenario: Login with invalid password
- **WHEN** a POST request is sent to `/api/auth/login` with a valid email but wrong password
- **THEN** the system returns HTTP 401 with `{"detail": "Invalid credentials"}`

#### Scenario: Login with inactive user
- **WHEN** a POST request is sent to `/api/auth/login` for a user where `is_active=False`
- **THEN** the system returns HTTP 401 with `{"detail": "Invalid credentials"}`

#### Scenario: Login requires 2FA but no code provided
- **WHEN** a POST request is sent to `/api/auth/login` with valid credentials for a user with `is_2fa_enabled=True` and no `totp_code` in the request body
- **THEN** the system returns HTTP 200 with `{"requires_2fa": true}` and does NOT issue tokens

#### Scenario: Login with 2FA code provided
- **WHEN** a POST request is sent to `/api/auth/login` with valid credentials and a valid `totp_code` for a user with `is_2fa_enabled=True`
- **THEN** the system returns the same response as a successful login (access token + refresh cookie)

### Requirement: JWT verification and current_user dependency

The system SHALL provide a FastAPI dependency `current_user` that extracts the JWT from the `Authorization: Bearer` header, verifies signature (HS256), validates expiration and required claims, checks the token blacklist in Redis, and returns a user context dict. If verification fails for any reason, the dependency SHALL raise HTTP 401.

#### Scenario: Valid JWT in Authorization header
- **WHEN** a request includes `Authorization: Bearer {valid_access_token}`
- **THEN** the `current_user` dependency returns a dict with `user_id`, `email`, `tenant_id`, `branch_ids`, `roles`, `jti`

#### Scenario: Expired JWT
- **WHEN** a request includes a JWT where `exp` is in the past
- **THEN** the system returns HTTP 401 with `{"detail": "Token expired"}`

#### Scenario: Invalid JWT signature
- **WHEN** a request includes a JWT signed with a different secret
- **THEN** the system returns HTTP 401 with `{"detail": "Invalid token"}`

#### Scenario: Missing Authorization header
- **WHEN** a request to a protected endpoint has no `Authorization` header
- **THEN** the system returns HTTP 401 with `{"detail": "Not authenticated"}`

#### Scenario: Blacklisted JWT
- **WHEN** a request includes a valid JWT whose `jti` exists in the Redis blacklist
- **THEN** the system returns HTTP 401 with `{"detail": "Token revoked"}`

#### Scenario: Redis unavailable during blacklist check
- **WHEN** a request includes a valid JWT but Redis is unreachable
- **THEN** the system returns HTTP 401 (fail-closed: reject all tokens when blacklist cannot be verified)

### Requirement: Token refresh with rotation

The system SHALL accept POST requests to `/api/auth/refresh` with the refresh token from the HttpOnly cookie. It SHALL verify the refresh token, issue a new access token and a new refresh token (rotation), blacklist the old refresh token in Redis, and set the new refresh token as an HttpOnly cookie.

#### Scenario: Successful token refresh
- **WHEN** a POST request is sent to `/api/auth/refresh` with a valid refresh token cookie
- **THEN** the system returns HTTP 200 with a new `access_token` in the response body
- **AND** a new `refresh_token` cookie replaces the old one
- **AND** the old refresh token is added to the Redis blacklist with TTL equal to its remaining lifetime

#### Scenario: Refresh with expired refresh token
- **WHEN** a POST request is sent to `/api/auth/refresh` with an expired refresh token cookie
- **THEN** the system returns HTTP 401 with `{"detail": "Refresh token expired"}`

#### Scenario: Refresh with missing cookie
- **WHEN** a POST request is sent to `/api/auth/refresh` without a refresh token cookie
- **THEN** the system returns HTTP 401 with `{"detail": "Refresh token missing"}`

#### Scenario: Refresh with blacklisted (already-rotated) token triggers nuclear revocation
- **WHEN** a POST request is sent to `/api/auth/refresh` with a refresh token that is in the Redis blacklist
- **THEN** the system invalidates ALL tokens for that user (nuclear revocation: adds a user-level blacklist entry in Redis)
- **AND** returns HTTP 401 with `{"detail": "Token reuse detected"}`

### Requirement: Logout with token blacklisting

The system SHALL accept POST requests to `/api/auth/logout` with a valid access token. It SHALL add the access token's `jti` to the Redis blacklist with TTL equal to the token's remaining lifetime, and clear the refresh token cookie.

#### Scenario: Successful logout
- **WHEN** an authenticated POST request is sent to `/api/auth/logout`
- **THEN** the system returns HTTP 200 with `{"detail": "Logged out"}`
- **AND** the access token's `jti` is added to the Redis blacklist
- **AND** the refresh token cookie is cleared (set to empty with `max-age=0`)

#### Scenario: Logout with already-expired token
- **WHEN** a POST request is sent to `/api/auth/logout` with an expired access token
- **THEN** the system returns HTTP 401 (standard token verification applies)

### Requirement: Current user info endpoint

The system SHALL provide `GET /api/auth/me` that returns the authenticated user's information from the database (not just the JWT claims).

#### Scenario: Get current user info
- **WHEN** an authenticated GET request is sent to `/api/auth/me`
- **THEN** the system returns HTTP 200 with `{"id", "email", "full_name", "tenant_id", "branch_ids", "roles", "is_2fa_enabled"}`

#### Scenario: User not found in database
- **WHEN** an authenticated GET request is sent to `/api/auth/me` but the user no longer exists in the database (e.g., soft-deleted after token was issued)
- **THEN** the system returns HTTP 401 with `{"detail": "User not found"}`

### Requirement: Password hashing with bcrypt

The system SHALL hash passwords using bcrypt (via passlib CryptContext) with 12 rounds. Password verification SHALL use constant-time comparison. The system SHALL support transparent algorithm migration via passlib's `deprecated="auto"` setting.

#### Scenario: Password hash on user creation
- **WHEN** a user is created or password is changed
- **THEN** the password is stored as a bcrypt hash (starting with `$2b$`)

#### Scenario: Password verification
- **WHEN** a login attempt provides a password
- **THEN** the system uses constant-time bcrypt verification against the stored hash

### Requirement: Production secrets validation at startup

The system SHALL validate critical secrets at application startup when `ENVIRONMENT=production`. If any validation fails, the application SHALL refuse to start (fail-fast).

#### Scenario: Valid production configuration
- **WHEN** the application starts with `ENVIRONMENT=production` and `JWT_SECRET` is 32+ chars (not "dev-secret"), `COOKIE_SECURE=true`, `DEBUG=false`
- **THEN** the application starts normally

#### Scenario: Weak JWT_SECRET in production
- **WHEN** the application starts with `ENVIRONMENT=production` and `JWT_SECRET` is less than 32 characters or equals "dev-secret"
- **THEN** the application refuses to start and logs the specific validation failure

#### Scenario: Development mode skips validation
- **WHEN** the application starts with `ENVIRONMENT=development`
- **THEN** secret validation is skipped and default values are accepted
