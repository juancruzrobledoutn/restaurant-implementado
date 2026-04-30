## Why

The system has models (Tenant, Branch, User, UserBranchRole from C-02) but no way to authenticate or authorize requests. Every subsequent change (C-04 through C-23) depends on `current_user`, `verify_jwt()`, and `PermissionContext` to enforce tenant isolation, branch access, and role-based permissions. Auth is the single gate blocking ALL further development. Without it, no endpoint can be protected, no multi-tenant query can be scoped, and no role-based action can be enforced.

## What Changes

- **JWT authentication flow**: `POST /api/auth/login` issues access token (15 min, HS256) + refresh token (7 days, HttpOnly cookie with `SameSite=lax`, `Secure` in production, `path=/api/auth`). JWT payload includes `sub`, `tenant_id`, `branch_ids`, `roles`, `email`, `jti`, `type` (`access`/`refresh`), `iss`, `aud`, `iat`, `exp`.
- **Token refresh with rotation**: `POST /api/auth/refresh` reads the HttpOnly cookie, issues a new access + refresh token pair, and blacklists the previous refresh token in Redis. Reuse of a rotated refresh token triggers **nuclear revocation** (all tokens for that user invalidated).
- **Logout with blacklist**: `POST /api/auth/logout` blacklists the access token in Redis with TTL equal to remaining token lifetime.
- **Current user endpoint**: `GET /api/auth/me` returns authenticated user info (id, email, full_name, tenant_id, branch_ids, roles).
- **Two-factor authentication (TOTP)**: `POST /api/auth/2fa/setup` generates a TOTP secret + provisioning URI, `POST /api/auth/2fa/verify` validates a TOTP code and activates 2FA, `POST /api/auth/2fa/disable` deactivates 2FA (requires current TOTP code).
- **Rate limiting**: Login endpoint rate-limited at 5 requests per 60-second window, dual-keyed by IP and email. Implemented via Redis + Lua atomic script. **Fail-closed**: if Redis is down, login requests are rejected.
- **Token blacklist fail-closed**: If Redis is unavailable during blacklist check, ALL tokens are rejected (security over availability).
- **`current_user` dependency**: FastAPI dependency that extracts and verifies JWT from `Authorization: Bearer` header, checks blacklist, and returns user context dict.
- **`verify_jwt()` function**: Decodes and validates JWT (signature, expiration, required claims, type).
- **PermissionContext**: Strategy-pattern authorization with `require_management()` (ADMIN or MANAGER) and `require_branch_access(branch_id)` (verifies branch_id in user's branch_ids). Strategy registry maps each role to its permission strategy (AdminStrategy, ManagerStrategy, KitchenStrategy, WaiterStrategy).
- **Password hashing**: bcrypt via passlib for secure password storage and verification.
- **Production secrets validation**: `validate_production_secrets()` at startup ensures JWT_SECRET is 32+ chars and not default, COOKIE_SECURE=true, DEBUG=false in production. App refuses to start if validation fails.
- **Security headers middleware**: CSP, HSTS (production only), X-Frame-Options DENY, X-Content-Type-Options nosniff, Permissions-Policy, Referrer-Policy.
- **CORS configuration**: Configurable allowed origins; localhost defaults for development.

## Capabilities

### New Capabilities
- `jwt-auth`: JWT token issuance, verification, refresh rotation, blacklisting, and `current_user` dependency
- `rbac-permissions`: Role-based access control via PermissionContext with strategy pattern per role (ADMIN, MANAGER, KITCHEN, WAITER)
- `rate-limiting`: Redis+Lua atomic rate limiting for auth endpoints with fail-closed policy
- `two-factor-auth`: TOTP-based two-factor authentication setup, verification, and disabling via pyotp
- `security-middleware`: Security headers, CORS configuration, and production secrets validation

### Modified Capabilities
_(none -- no existing specs are modified by this change)_

## Impact

- **Backend files created/modified**:
  - `backend/shared/security/auth.py` -- JWT issuance, verification, blacklist, refresh rotation
  - `backend/shared/security/password.py` -- bcrypt hashing/verification
  - `backend/rest_api/routers/auth.py` -- thin auth router (login, refresh, logout, me, 2FA)
  - `backend/rest_api/services/auth_service.py` -- auth domain service (login logic, 2FA, rate limit orchestration)
  - `backend/rest_api/services/permissions/__init__.py` -- PermissionContext
  - `backend/rest_api/services/permissions/strategies.py` -- role strategy implementations
  - `backend/rest_api/core/middlewares.py` -- SecurityHeadersMiddleware
  - `backend/rest_api/core/dependencies.py` -- `current_user` FastAPI dependency
  - `backend/shared/config/settings.py` -- JWT settings, production validation
  - `backend/shared/config/constants.py` -- Roles enum, MANAGEMENT_ROLES
  - `backend/rest_api/main.py` -- CORS configuration, middleware registration
  - `backend/rest_api/schemas/auth.py` -- Pydantic request/response schemas
- **Infrastructure dependencies**: Redis 7 (token blacklist, rate limiting), PostgreSQL 16 (User model)
- **New Python dependencies**: `pyjwt`, `passlib[bcrypt]`, `pyotp`, `slowapi`, `qrcode` (for 2FA provisioning URI)
- **API surface**: 7 new endpoints under `/api/auth/`
- **Security posture**: Fail-closed on Redis unavailability; nuclear revocation on refresh token reuse
- **Downstream impact**: Every subsequent change (C-04 through C-23) depends on `current_user` and `PermissionContext` from this change
