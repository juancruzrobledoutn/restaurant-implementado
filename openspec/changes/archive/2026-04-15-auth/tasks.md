## 1. Configuration and Dependencies

- [x] 1.1 Add Python dependencies: `pyjwt`, `passlib[bcrypt]`, `pyotp`, `slowapi`, `qrcode[pil]` to `backend/requirements.txt`
- [x] 1.2 Add auth settings to `backend/shared/config/settings.py`: `JWT_SECRET`, `JWT_ALGORITHM` (HS256), `ACCESS_TOKEN_TTL` (900s), `REFRESH_TOKEN_TTL` (604800s), `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN`, `ALLOWED_ORIGINS`, `LOGIN_RATE_LIMIT` (5), `LOGIN_RATE_WINDOW` (60)
- [x] 1.3 Implement `validate_production_secrets()` in settings: check JWT_SECRET >= 32 chars and not "dev-secret", COOKIE_SECURE=true, DEBUG=false, ALLOWED_ORIGINS set. Call at app startup when ENVIRONMENT=production. Fail-fast if any check fails.
- [x] 1.4 Extend `backend/shared/config/constants.py`: ensure `Roles` enum (ADMIN, MANAGER, KITCHEN, WAITER) and `MANAGEMENT_ROLES = {Roles.ADMIN, Roles.MANAGER}` exist (may already exist from C-02, verify and extend if needed)

## 2. User Model Extensions

- [x] 2.1 Add fields to User model: `totp_secret` (nullable String), `is_2fa_enabled` (Boolean, default False), `last_login_at` (nullable DateTime)
- [x] 2.2 Create Alembic migration for the new User fields (auto-generate, review, adjust)

## 3. Password Module

- [x] 3.1 Create `backend/shared/security/password.py`: `hash_password(plain)` and `verify_password(plain, hashed)` using passlib CryptContext with bcrypt scheme, 12 rounds, `deprecated="auto"` for future algorithm migration

## 4. JWT Module

- [x] 4.1 Create `backend/shared/security/auth.py` with `create_access_token(user)`: builds JWT with claims `sub`, `tenant_id`, `branch_ids`, `roles`, `email`, `jti` (uuid4), `type` ("access"), `iss`, `aud`, `iat`, `exp` (15 min). Signs with HS256 + JWT_SECRET.
- [x] 4.2 Add `create_refresh_token(user)`: same structure but `type` ("refresh"), `exp` (7 days), different `jti`
- [x] 4.3 Add `verify_jwt(token, expected_type)`: decode with HS256, validate signature, expiration, required claims, and `type` matches `expected_type`. Raise appropriate errors for each failure mode.
- [x] 4.4 Add `blacklist_token(jti, ttl)`: store `jti` in Redis with TTL equal to remaining token lifetime. Key format: `blacklist:{jti}`
- [x] 4.5 Add `is_blacklisted(jti)`: check Redis for `blacklist:{jti}`. Return True if exists. If Redis is unreachable, return True (fail-closed).
- [x] 4.6 Add `nuclear_revoke(user_id)`: store `nuclear:{user_id}:{timestamp}` in Redis. During token verification, check if token `iat` is before the nuclear revocation timestamp. TTL = max token lifetime (7 days).

## 5. Rate Limiting Module

- [x] 5.1 Create Redis Lua script for atomic email-based rate limiting: INCR + EXPIRE in one atomic operation, returning current count. Store in `backend/shared/security/rate_limit.lua`
- [x] 5.2 Create `backend/rest_api/services/rate_limit_service.py`: `check_email_rate_limit(email)` loads and executes Lua script, returns True if under limit. Raises HTTP 429 if exceeded. Raises HTTP 503 if Redis unavailable (fail-closed).
- [x] 5.3 Configure slowapi in `backend/rest_api/main.py` for IP-based rate limiting. Create limiter instance with Redis backend.

## 6. Permissions Module

- [x] 6.1 Create `backend/rest_api/services/permissions/strategies.py`: `AdminStrategy`, `ManagerStrategy`, `KitchenStrategy`, `WaiterStrategy` classes. Each implements `can_create(resource)`, `can_edit(resource)`, `can_delete(resource)`, `can_access_branch(branch_id, user_branch_ids)`.
- [x] 6.2 Create `backend/rest_api/services/permissions/__init__.py`: `PermissionContext(user_dict)` with methods `require_management()` (raises 403 if not ADMIN/MANAGER), `require_branch_access(branch_id)` (raises 403 if branch not in user's branch_ids, ADMIN bypasses). `STRATEGY_REGISTRY` dict maps Roles to strategy classes.

## 7. Auth Domain Service

- [x] 7.1 Create `backend/rest_api/schemas/auth.py`: Pydantic models -- `LoginRequest(email, password, totp_code: Optional)`, `LoginResponse(access_token, token_type, user: UserResponse)`, `TwoFactorRequiredResponse(requires_2fa: bool)`, `UserResponse(id, email, full_name, tenant_id, branch_ids, roles, is_2fa_enabled)`, `TwoFactorSetupResponse(secret, provisioning_uri)`, `TwoFactorVerifyRequest(totp_code)`
- [x] 7.2 Create `backend/rest_api/services/auth_service.py` with `AuthService` class:
  - `authenticate(email, password, totp_code, db)`: check rate limits, query User by email (filter `is_active.is_(True)`), verify password (constant-time even if user not found), check 2FA if enabled, issue tokens, update `last_login_at`, return LoginResponse or TwoFactorRequiredResponse
  - `refresh(refresh_token, db)`: verify refresh JWT, check blacklist (nuclear revocation detection), issue new pair, blacklist old refresh token
  - `logout(jti, exp)`: blacklist access token, return confirmation
  - `get_me(user_id, db)`: query User from DB, return UserResponse
- [x] 7.3 Add 2FA methods to AuthService:
  - `setup_2fa(user_id, db)`: generate pyotp secret, save to user, return secret + provisioning_uri
  - `verify_2fa(user_id, totp_code, db)`: validate code against stored secret (valid_window=1 for clock drift), set `is_2fa_enabled=True`
  - `disable_2fa(user_id, totp_code, db)`: verify current code, clear `totp_secret`, set `is_2fa_enabled=False`

## 8. FastAPI Dependencies

- [x] 8.1 Create `backend/rest_api/core/dependencies.py`: `current_user` dependency -- extract `Authorization: Bearer` header, call `verify_jwt(token, "access")`, check `is_blacklisted(jti)`, check nuclear revocation, return user context dict. Raise 401 on any failure.

## 9. Security Middleware

- [x] 9.1 Create `SecurityHeadersMiddleware` in `backend/rest_api/core/middlewares.py`: add CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff, Permissions-Policy, Referrer-Policy on every response. Add HSTS only when ENVIRONMENT=production.
- [x] 9.2 Configure CORS in `backend/rest_api/main.py`: development defaults (localhost:5176, 5177, 5178, 8000, 8001), production from ALLOWED_ORIGINS env var, `allow_credentials=True`, appropriate methods and headers.

## 10. Auth Router

- [x] 10.1 Create `backend/rest_api/routers/auth.py` -- thin router, all logic delegated to AuthService:
  - `POST /api/auth/login`: accept LoginRequest, call AuthService.authenticate, set refresh cookie on response, return LoginResponse. Apply slowapi rate limit (5/min per IP).
  - `POST /api/auth/refresh`: read refresh_token cookie, call AuthService.refresh, set new cookie, return access token. Apply slowapi rate limit (5/min per IP).
  - `POST /api/auth/logout`: require current_user dependency, call AuthService.logout, clear cookie.
  - `GET /api/auth/me`: require current_user dependency, call AuthService.get_me.
- [x] 10.2 Add 2FA endpoints to auth router:
  - `POST /api/auth/2fa/setup`: require current_user, call AuthService.setup_2fa
  - `POST /api/auth/2fa/verify`: require current_user, call AuthService.verify_2fa
  - `POST /api/auth/2fa/disable`: require current_user, call AuthService.disable_2fa
- [x] 10.3 Register auth router in `backend/rest_api/main.py` with prefix `/api/auth`. Register SecurityHeadersMiddleware. Ensure middleware order: security headers outermost.

## 11. Tests

- [x] 11.1 Create `backend/tests/test_password.py`: test hash_password produces bcrypt hash, verify_password succeeds with correct password, verify_password fails with wrong password
- [x] 11.2 Create `backend/tests/test_jwt.py`: test create_access_token contains all required claims, verify_jwt accepts valid token, verify_jwt rejects expired token, verify_jwt rejects wrong signature, verify_jwt rejects wrong type
- [x] 11.3 Create `backend/tests/test_auth_service.py`: test successful login flow, test login with invalid credentials returns 401, test login with inactive user returns 401, test 2FA required response when 2FA enabled without code, test 2FA login with valid code succeeds
- [x] 11.4 Create `backend/tests/test_auth_router.py` (integration): test POST /api/auth/login returns access_token + sets cookie, test POST /api/auth/refresh rotates tokens, test POST /api/auth/logout blacklists token, test GET /api/auth/me returns user info, test 2FA setup/verify/disable flow
- [x] 11.5 Create `backend/tests/test_rate_limit.py`: test login succeeds under limit (< 5 attempts), test login returns 429 after 5 attempts from same IP, test email-based rate limit returns 429 after 5 attempts for same email from different IPs
- [x] 11.6 Create `backend/tests/test_permissions.py`: test PermissionContext.require_management passes for ADMIN and MANAGER, test require_management raises 403 for KITCHEN and WAITER, test require_branch_access passes for ADMIN on any branch, test require_branch_access passes for assigned branch, test require_branch_access raises 403 for unassigned branch
- [x] 11.7 Create `backend/tests/test_token_blacklist.py`: test blacklisted token rejected by current_user dependency, test nuclear revocation invalidates all user tokens, test fail-closed when Redis unavailable (mock Redis connection failure)
- [x] 11.8 Create `backend/tests/test_security_middleware.py`: test security headers present in responses, test HSTS present only in production, test CORS configured with correct origins

## 12. Seed Data Update

- [x] 12.1 Update seed script to hash the ADMIN user's password with bcrypt (instead of plaintext). Ensure seed user can actually log in via the new auth endpoints.
