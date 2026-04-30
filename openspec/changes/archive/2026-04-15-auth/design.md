## Context

The system currently has core models (Tenant, Branch, User, UserBranchRole) from C-02 with password hash fields on User, but no authentication or authorization infrastructure. Every endpoint beyond public ones requires a verified identity and role-based access control. This change introduces the complete auth stack that all subsequent changes (C-04 through C-23) depend on.

Constraints:
- Multi-tenant isolation is non-negotiable: every authenticated request MUST carry tenant_id
- Clean Architecture: routers are thin HTTP handlers, all logic lives in domain services
- Redis is already available (deployed in C-01 via docker-compose)
- User model already has `hashed_password`, `is_active`, `tenant_id`, and the `UserBranchRole` relationship
- The system is greenfield -- no legacy auth to migrate from

## Goals / Non-Goals

**Goals:**
- Implement complete JWT auth lifecycle (login, refresh, logout, me) with security best practices
- Provide PermissionContext as the single authorization mechanism for all future changes
- Implement TOTP-based 2FA as an optional security layer for staff accounts
- Ensure fail-closed behavior: Redis unavailability rejects all auth operations rather than allowing unverified access
- Rate-limit login to prevent brute force attacks
- Validate production secrets at startup (fail-fast)

**Non-Goals:**
- Table Token (HMAC) for pwaMenu diners -- deferred to C-08 (table-sessions)
- WebSocket authentication strategies -- deferred to C-09 (ws-gateway-base)
- Frontend auth stores, interceptors, or refresh logic -- deferred to C-14 (dashboard-shell) and C-20 (pwaWaiter-shell)
- OAuth2 / social login -- not in scope for MVP
- Password reset / forgot password flow -- not in scope for MVP
- Account lockout after N failed attempts -- rate limiting covers brute force; lockout adds complexity without proportional value at this stage
- Multi-tab synchronization via BroadcastChannel -- frontend concern, deferred to frontend changes

## Decisions

### D-01: HS256 for JWT signing (symmetric key)

**Decision**: Use HS256 (HMAC-SHA256) with a shared secret (`JWT_SECRET`).

**Alternatives considered**:
- RS256 (asymmetric): More secure for distributed verification (public key can be shared). Adds key management complexity (key rotation, JWKS endpoint). Overkill for a monolith where the same service signs and verifies.
- ES256 (ECDSA): Same tradeoffs as RS256, smaller signatures but more CPU per verification.

**Rationale**: Single backend service both signs and verifies tokens. HS256 is simpler, faster, and sufficient. If the system grows to multiple verification services, migrate to RS256 with a JWKS endpoint.

### D-02: Refresh token rotation with nuclear revocation

**Decision**: Every refresh issues a new refresh token and blacklists the old one. If a blacklisted refresh token is presented, revoke ALL tokens for that user.

**Alternatives considered**:
- No rotation (static refresh token for 7 days): Simpler but a stolen refresh token grants 7 days of access with no detection.
- Rotation without nuclear revocation: Detects replay but allows attacker to continue with the token they obtained before rotation.

**Rationale**: Rotation + nuclear revocation is the industry standard (RFC 6749 Section 10.4). The cost is one extra Redis write per refresh (blacklist old token), which is negligible. Nuclear revocation catches the specific attack where an attacker steals a refresh token and races the legitimate user.

### D-03: Dual-key rate limiting (IP + email) via Redis Lua

**Decision**: Rate limit login by both IP address AND email, using atomic Redis Lua scripts. 5 attempts per 60-second sliding window per key.

**Alternatives considered**:
- IP-only rate limiting via slowapi: Easy but allows credential stuffing across many accounts from one IP, and doesn't protect against distributed attacks on a single account.
- Email-only rate limiting: Protects individual accounts but doesn't prevent one IP from probing many emails.
- Token bucket via Redis: More complex, better for sustained rate control. Overkill for login where simple window counting suffices.

**Rationale**: Dual-key catches both attack vectors. Lua script ensures atomicity (no race conditions between check and increment). slowapi handles per-IP as middleware; the Lua script handles per-email inside the auth service.

### D-04: Auth domain service owns all logic

**Decision**: `AuthService` contains all authentication logic (credential verification, token issuance, rate limit orchestration, 2FA verification). The router is a thin HTTP adapter.

**Alternatives considered**:
- Logic in router with utility functions: Faster to write but violates Clean Architecture and makes testing harder.
- Separate services per concern (TokenService, RateLimitService, TwoFactorService): More granular but introduces unnecessary indirection at this stage. These can be extracted later if AuthService grows too large.

**Rationale**: Clean Architecture mandates domain services. A single AuthService keeps the auth domain cohesive. Internal helper modules (`auth.py` for JWT, `password.py` for bcrypt) handle technical concerns.

### D-05: PermissionContext with Strategy pattern

**Decision**: `PermissionContext` wraps the authenticated user and delegates permission checks to role-specific strategies (AdminStrategy, ManagerStrategy, KitchenStrategy, WaiterStrategy).

**Alternatives considered**:
- Simple role-checking functions (`is_admin()`, `has_branch_access()`): Works but scatters permission logic across the codebase.
- Decorator-based permissions (`@require_role("ADMIN")`): Clean syntax but hides permission logic in decorators, making it harder to compose and test.
- Policy/capability-based (e.g., `can("create", "category")`): More flexible but requires maintaining a permission matrix. Overkill when roles are few and well-defined.

**Rationale**: Strategy pattern localizes all permission logic per role in one place. Adding a new role means adding one strategy class. `PermissionContext` provides a clean API for routers: `ctx.require_management()`, `ctx.require_branch_access(branch_id)`.

### D-06: TOTP secret stored encrypted on User model

**Decision**: Store the TOTP secret in `User.totp_secret` (nullable string). The secret is base32-encoded as generated by pyotp. 2FA is optional -- `User.is_2fa_enabled` (boolean, default False) tracks activation status.

**Alternatives considered**:
- Separate 2FA model/table: More normalized but adds a join for every auth check. Overkill for a single 2FA method.
- Encrypt TOTP secret at rest with a separate key: Better security but adds key management. Acceptable risk since the DB is already access-controlled and the secret is only useful with the user's password.

**Rationale**: Keeping it on the User model is simple and avoids an extra query on every login. The secret is only meaningful when combined with the time-based algorithm, and DB access already requires compromise. If we add backup codes or multiple 2FA methods later, we can extract to a separate model.

### D-07: Refresh token stored in HttpOnly cookie

**Decision**: Refresh token is set as an HttpOnly cookie with `SameSite=lax`, `Secure=true` (production), `path=/api/auth`, 7-day max-age.

**Alternatives considered**:
- Refresh token in response body (frontend stores in memory/localStorage): Vulnerable to XSS. localStorage is accessible to any script on the page.
- Refresh token in HttpOnly cookie with `SameSite=strict`: Breaks cross-origin flows. `lax` is sufficient since refresh only uses POST.

**Rationale**: HttpOnly prevents JavaScript access (XSS protection). `SameSite=lax` prevents CSRF on mutation endpoints. `path=/api/auth` restricts the cookie to auth endpoints only (minimizes exposure).

### D-08: Password hashing with bcrypt (passlib)

**Decision**: Use passlib with bcrypt backend, default 12 rounds.

**Alternatives considered**:
- Argon2id: Stronger (memory-hard), recommended by OWASP. Requires `argon2-cffi` dependency. Marginally more complex setup.
- scrypt: Also memory-hard but less tooling support in Python.

**Rationale**: bcrypt is well-tested, widely supported, and passlib provides a clean API with automatic scheme detection for future migration. If we need to upgrade to Argon2id later, passlib's `CryptContext` supports transparent migration (verify old hashes, re-hash on next login).

## Risks / Trade-offs

- **[Risk] Redis single point of failure for auth** -- Fail-closed means Redis downtime blocks ALL authenticated requests. Mitigation: Redis is already critical infrastructure (used for caching, events). Monitor Redis health. Docker healthcheck + restart policy. Accept this tradeoff: security over availability.

- **[Risk] Nuclear revocation false positives** -- A legitimate user on two devices could trigger nuclear revocation if token rotation races. Mitigation: Unlikely in practice because the old refresh token is blacklisted atomically. Only triggers if the exact same old token is presented again. Log nuclear revocation events for monitoring.

- **[Risk] TOTP secret in plaintext in DB** -- If the database is compromised, TOTP secrets are exposed. Mitigation: TOTP alone is not sufficient for auth (still needs password). DB access is already a critical breach. Accept this risk for simplicity; add encryption-at-rest if compliance requires it.

- **[Risk] HS256 key compromise** -- If `JWT_SECRET` leaks, all tokens can be forged. Mitigation: Production validation ensures secret is 32+ chars and not default. Store in secret manager (not in code). Key rotation requires invalidating all existing tokens (nuclear option).

- **[Trade-off] No account lockout** -- Rate limiting (5/60s) slows brute force but doesn't lock accounts. Trade-off: lockout enables denial-of-service against legitimate users (lock someone out by trying wrong passwords). Rate limiting is sufficient for MVP.

- **[Trade-off] No password reset flow** -- Users who forget passwords need admin intervention. Trade-off: password reset requires email infrastructure (SMTP) and adds attack surface. Defer to a future change when email service is in scope.

## File Structure

```
backend/
  shared/
    security/
      auth.py          -- create_access_token(), create_refresh_token(), verify_jwt(),
                          blacklist_token(), is_blacklisted(), nuclear_revoke()
      password.py       -- hash_password(), verify_password() via passlib bcrypt
    config/
      settings.py       -- JWT_SECRET, JWT_ALGORITHM, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL,
                          COOKIE_SECURE, COOKIE_SAMESITE, validate_production_secrets()
      constants.py      -- Roles enum, MANAGEMENT_ROLES (already exists from C-02, extend if needed)
  rest_api/
    routers/
      auth.py           -- thin router: login, refresh, logout, me, 2fa/*
    services/
      auth_service.py   -- AuthService: authenticate(), refresh(), logout(), get_me(),
                          setup_2fa(), verify_2fa(), disable_2fa(), check_rate_limit()
      permissions/
        __init__.py     -- PermissionContext class
        strategies.py   -- AdminStrategy, ManagerStrategy, KitchenStrategy, WaiterStrategy
    core/
      dependencies.py   -- current_user FastAPI dependency (Depends)
      middlewares.py     -- SecurityHeadersMiddleware
    schemas/
      auth.py           -- LoginRequest, LoginResponse, TokenResponse, UserResponse,
                          TwoFactorSetupResponse, TwoFactorVerifyRequest
    main.py             -- CORS config, middleware registration, router inclusion
```

## Open Questions

- **Q1**: Should we add a `last_login_at` timestamp on User for audit purposes? Leaning yes (simple ALTER, valuable for security auditing). Will implement unless explicitly excluded.
- **Q2**: Should the 2FA setup endpoint return a QR code image (base64) or just the provisioning URI? Leaning URI-only (frontend generates QR via a JS library, reduces backend complexity).
