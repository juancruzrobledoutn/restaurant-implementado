## ADDED Requirements

### Requirement: Dashboard exposes 2FA enrollment and disable flow

The Dashboard SHALL expose the complete 2FA lifecycle (enable, verify, disable) from the `/settings` page in the "Perfil" tab. The UI MUST consume the existing `POST /api/auth/2fa/setup`, `POST /api/auth/2fa/verify`, and `POST /api/auth/2fa/disable` endpoints without changing their contracts.

#### Scenario: Enable flow available to every authenticated role
- **WHEN** any authenticated staff user (ADMIN, MANAGER, WAITER, KITCHEN) navigates to `/settings` with `?tab=profile`
- **THEN** the 2FA subsection is visible and functional for them

#### Scenario: UI reflects backend state on load
- **WHEN** the Perfil tab mounts
- **THEN** the UI reads `authStore.user.is2FAEnabled` and renders the correct state (disabled, enabled, or setup-pending)

#### Scenario: Successful verify triggers user refresh
- **WHEN** `POST /api/auth/2fa/verify` returns 200
- **THEN** the client calls `GET /api/auth/me` to refresh `authStore.user` so `is2FAEnabled` becomes `true` without a full page reload

#### Scenario: Disable requires current TOTP code input
- **WHEN** the user initiates disable from the UI
- **THEN** a modal prompts for the current 6-digit TOTP code and the client sends it to `POST /api/auth/2fa/disable`
- **AND** on success, `authStore.user.is2FAEnabled` is refreshed to `false`
