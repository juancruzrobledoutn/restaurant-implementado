## ADDED Requirements

### Requirement: 2FA setup generates TOTP secret

The system SHALL provide `POST /api/auth/2fa/setup` (authenticated) that generates a TOTP secret using pyotp, stores it on the User model (but does NOT enable 2FA yet), and returns the provisioning URI and base32 secret to the client.

#### Scenario: Setup 2FA for user without existing 2FA
- **WHEN** an authenticated POST request is sent to `/api/auth/2fa/setup` by a user with `is_2fa_enabled=False`
- **THEN** the system generates a new TOTP secret, stores it in `User.totp_secret`, and returns HTTP 200 with `{"secret": "<base32>", "provisioning_uri": "otpauth://totp/..."}`
- **AND** `is_2fa_enabled` remains `False` until verification

#### Scenario: Setup 2FA for user who already has 2FA enabled
- **WHEN** an authenticated POST request is sent to `/api/auth/2fa/setup` by a user with `is_2fa_enabled=True`
- **THEN** the system returns HTTP 400 with `{"detail": "2FA already enabled"}`

### Requirement: 2FA verification activates TOTP

The system SHALL provide `POST /api/auth/2fa/verify` (authenticated) that validates a TOTP code against the stored secret. If valid, it enables 2FA on the user account.

#### Scenario: Valid TOTP code activates 2FA
- **WHEN** an authenticated POST request is sent to `/api/auth/2fa/verify` with a valid 6-digit TOTP code
- **THEN** the system sets `User.is_2fa_enabled=True` and returns HTTP 200 with `{"detail": "2FA enabled"}`

#### Scenario: Invalid TOTP code
- **WHEN** an authenticated POST request is sent to `/api/auth/2fa/verify` with an invalid TOTP code
- **THEN** the system returns HTTP 400 with `{"detail": "Invalid TOTP code"}`

#### Scenario: Verify without prior setup
- **WHEN** an authenticated POST request is sent to `/api/auth/2fa/verify` but `User.totp_secret` is null
- **THEN** the system returns HTTP 400 with `{"detail": "2FA not set up"}`

### Requirement: 2FA disable requires current TOTP code

The system SHALL provide `POST /api/auth/2fa/disable` (authenticated) that requires a valid TOTP code to deactivate 2FA. This prevents disabling 2FA if the user's session is hijacked but the attacker doesn't have the TOTP device.

#### Scenario: Disable 2FA with valid code
- **WHEN** an authenticated POST request is sent to `/api/auth/2fa/disable` with a valid TOTP code
- **THEN** the system sets `User.is_2fa_enabled=False`, clears `User.totp_secret`, and returns HTTP 200 with `{"detail": "2FA disabled"}`

#### Scenario: Disable 2FA with invalid code
- **WHEN** an authenticated POST request is sent to `/api/auth/2fa/disable` with an invalid TOTP code
- **THEN** the system returns HTTP 400 with `{"detail": "Invalid TOTP code"}`

#### Scenario: Disable 2FA when not enabled
- **WHEN** an authenticated POST request is sent to `/api/auth/2fa/disable` for a user with `is_2fa_enabled=False`
- **THEN** the system returns HTTP 400 with `{"detail": "2FA not enabled"}`

### Requirement: Login flow integrates 2FA check

The login flow SHALL check if the user has `is_2fa_enabled=True`. If so, and no `totp_code` is provided in the request body, the system SHALL return a partial response indicating 2FA is required (without issuing tokens). If a `totp_code` is provided, the system SHALL verify it before issuing tokens.

#### Scenario: Login with 2FA enabled and valid code
- **WHEN** a login request includes valid credentials and a valid `totp_code` for a 2FA-enabled user
- **THEN** tokens are issued as in a normal successful login

#### Scenario: Login with 2FA enabled and invalid code
- **WHEN** a login request includes valid credentials but an invalid `totp_code` for a 2FA-enabled user
- **THEN** the system returns HTTP 401 with `{"detail": "Invalid TOTP code"}`

#### Scenario: TOTP window tolerance
- **WHEN** a TOTP code from the immediately previous or next 30-second window is provided
- **THEN** the system accepts it (1-step tolerance to account for clock drift)
