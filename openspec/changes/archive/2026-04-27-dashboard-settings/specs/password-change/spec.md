## ADDED Requirements

### Requirement: Change password endpoint

The system SHALL provide `POST /api/auth/change-password` (authenticated) that accepts `current_password` and `new_password`. The endpoint MUST verify `current_password` against the stored hash in constant time, validate `new_password` against `SecurityPolicy` (≥8, ≤128, ≥1 digit, ≥1 uppercase), update the hashed password, rotate `password_updated_at`, and emit a structured log event `USER_PASSWORD_CHANGED` with `user_id`, `tenant_id`, and request metadata.

#### Scenario: Successful password change
- **WHEN** an authenticated user POSTs to `/api/auth/change-password` with correct `current_password` and a compliant `new_password`
- **THEN** the backend returns HTTP 200 with `{"detail": "Password changed"}`
- **AND** `User.hashed_password` is updated with the new hash
- **AND** `User.password_updated_at` is set to the current UTC timestamp
- **AND** a log entry with `event=USER_PASSWORD_CHANGED` is emitted

#### Scenario: Incorrect current password
- **WHEN** the request body contains a wrong `current_password`
- **THEN** the backend returns HTTP 400 with `{"detail": "Current password is incorrect"}`
- **AND** no database change occurs
- **AND** the password hash check runs in constant time (the response time is comparable to a successful check within normal variance)

#### Scenario: New password fails policy
- **WHEN** `new_password` is `short`
- **THEN** the backend returns HTTP 422 with a structured error listing the failed policy rules

#### Scenario: New password equals current
- **WHEN** `new_password` equals `current_password`
- **THEN** the backend returns HTTP 422 with `{"detail": "New password must differ from current"}`

#### Scenario: Tokens remain valid after change
- **WHEN** the user successfully changes their password
- **THEN** the current access token and refresh token remain valid until their natural expiry (no forced logout)

### Requirement: Change password service layer

The `AuthService` SHALL expose `change_password(user_id, current_password, new_password, db)` that performs the verification, policy validation, hash rotation, and commit via `safe_commit`. The router MUST delegate all logic to this service.

#### Scenario: Service uses constant-time compare
- **WHEN** `AuthService.change_password` is called
- **THEN** it uses `verify_password` (bcrypt, constant time) and not equality on the hash string

#### Scenario: Service rotates password_updated_at
- **WHEN** the service persists a new hash
- **THEN** it also sets `password_updated_at = datetime.now(timezone.utc)` in the same transaction
