## ADDED Requirements

### Requirement: Settings page with tabs gated by role

The Dashboard SHALL expose a `/settings` route rendering a tabbed layout whose visible tabs depend on the authenticated user's roles. The tablist MUST follow WAI-ARIA Authoring Practices (`role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`). The active tab SHALL be reflected in the URL query string (`?tab=<name>`) to be refresh-safe and shareable.

#### Scenario: ADMIN sees all three tabs
- **WHEN** a user with role ADMIN navigates to `/settings`
- **THEN** the page renders tabs "Sucursal", "Perfil", "Tenant" in that order
- **AND** the first visible tab is selected by default if no `?tab=` query param is present

#### Scenario: MANAGER sees Sucursal and Perfil
- **WHEN** a user with role MANAGER (and NOT ADMIN) navigates to `/settings`
- **THEN** the page renders tabs "Sucursal" and "Perfil"
- **AND** the "Tenant" tab is NOT present in the DOM

#### Scenario: WAITER or KITCHEN sees only Perfil
- **WHEN** a user whose roles are only WAITER and/or KITCHEN navigates to `/settings`
- **THEN** the page renders only the "Perfil" tab

#### Scenario: Query param selects tab on load
- **WHEN** a user navigates to `/settings?tab=profile`
- **THEN** the "Perfil" tab is the active tab
- **AND** the tab content for Perfil is visible, others hidden

#### Scenario: Switching tabs updates the URL
- **WHEN** the user clicks a different tab
- **THEN** the URL query string updates to `?tab=<name>` without a full navigation

#### Scenario: Query param pointing to a tab the user cannot see
- **WHEN** a WAITER navigates to `/settings?tab=tenant`
- **THEN** the page falls back to the first tab the user is allowed to see (Perfil)

### Requirement: Branch settings form

The "Sucursal" tab SHALL expose a form, implemented with `useActionState`, that edits the selected branch's `name`, `slug`, `address`, `phone`, `timezone`, and `opening_hours`. The form MUST show inline validation errors per field and disable the submit button while pending. On success, the store's `branchSettings` slice SHALL be updated and a toast SHALL confirm.

#### Scenario: User edits branch name and saves
- **WHEN** a MANAGER/ADMIN changes the "Nombre" field and submits
- **THEN** the form enters pending state, calls `PATCH /api/admin/branches/{branch_id}` with the new name, and on 200 displays a success toast
- **AND** the branchSettings slice is refreshed with the server response

#### Scenario: User enters invalid slug
- **WHEN** the user types `InvalidSlug!` in the slug field
- **THEN** an inline error "El slug solo admite minúsculas, números y guiones (3-60 chars)" appears under the field
- **AND** the submit button is disabled

#### Scenario: Server rejects duplicate slug
- **WHEN** the user submits with a slug already used by another branch of the same tenant
- **THEN** the backend returns 409 and the form displays an inline error "Ese slug ya está en uso"

#### Scenario: Changing slug triggers confirmation dialog
- **WHEN** the current branch slug is `sucursal-a` and the user changes it to `sucursal-b` and clicks "Guardar"
- **THEN** a dialog with `role="alertdialog"` appears showing the old URL and new URL of the public menu, requiring the user to re-type the new slug exactly before the "Confirmar" button is enabled
- **AND** clicking "Cancelar" closes the dialog without submitting

#### Scenario: Opening hours editor supports split schedules
- **WHEN** the user configures Monday with two intervals (09:00-14:00 and 20:00-23:30)
- **THEN** the form state reflects both intervals
- **AND** on submit, the backend receives the full shape for Monday as a two-element array

### Requirement: Password change form

The "Perfil" tab SHALL expose a password-change form with fields `currentPassword`, `newPassword`, and `confirmNewPassword`. The form MUST validate locally that `newPassword` satisfies the project's `SecurityPolicy` (≥8 chars, ≤128, at least one digit, at least one uppercase) and that `confirmNewPassword` matches `newPassword` before enabling submit.

#### Scenario: Successful password change
- **WHEN** the user fills currentPassword with the correct value, newPassword that meets policy, and matching confirmNewPassword
- **THEN** the form submits, backend returns 200, a success toast appears, and the fields clear

#### Scenario: Incorrect current password
- **WHEN** the user submits with an incorrect currentPassword
- **THEN** the backend returns 400 and the form displays an inline error on the currentPassword field "Contraseña actual incorrecta"
- **AND** the user remains authenticated

#### Scenario: New password does not match policy
- **WHEN** the user types `abc` in newPassword
- **THEN** an inline error lists the unmet policy rules (e.g., "Debe tener al menos 8 caracteres, una mayúscula y un número")
- **AND** submit is disabled

#### Scenario: Confirmation does not match
- **WHEN** newPassword is `AbCd1234!` and confirmNewPassword is `AbCd1234?`
- **THEN** an inline error "Las contraseñas no coinciden" appears on confirmNewPassword
- **AND** submit is disabled

### Requirement: Two-factor authentication section

The "Perfil" tab SHALL expose a 2FA subsection with three possible states driven by `authStore.user.is2FAEnabled` and local component state:
1. disabled: a "Habilitar 2FA" button that initiates setup.
2. setup-pending: shows QR code, base32 secret (copyable), a 6-digit TOTP input, and a "Verificar" button.
3. enabled: shows "2FA activo" and a "Deshabilitar" button.

#### Scenario: User starts 2FA setup
- **WHEN** the user (with `is2FAEnabled=false`) clicks "Habilitar 2FA"
- **THEN** the client calls `POST /api/auth/2fa/setup`, receives `{secret, provisioning_uri}`, and renders the QR image and the base32 secret
- **AND** an input field and "Verificar" button appear

#### Scenario: User completes 2FA verification
- **WHEN** the user scans the QR, enters a valid 6-digit code, and clicks "Verificar"
- **THEN** the client calls `POST /api/auth/2fa/verify` with the code, receives 200, refreshes `user.is2FAEnabled` via `getMe`, and the UI transitions to the "enabled" state
- **AND** a success toast confirms

#### Scenario: User cancels 2FA setup
- **WHEN** the user is in "setup-pending" state and clicks "Cancelar"
- **THEN** the UI returns to "disabled" state without any further server call
- **AND** the next setup attempt calls `/2fa/setup` again (server regenerates secret)

#### Scenario: User disables 2FA with valid TOTP code
- **WHEN** the user (with `is2FAEnabled=true`) clicks "Deshabilitar", enters the current TOTP code, and confirms
- **THEN** the client calls `POST /api/auth/2fa/disable`, receives 200, refreshes `user.is2FAEnabled`, and the UI returns to "disabled" state

#### Scenario: Invalid TOTP on verify
- **WHEN** the user enters a 6-digit code that the backend rejects
- **THEN** the backend returns 400 with detail "Invalid TOTP code" and the UI shows an inline error

### Requirement: Tenant settings form (ADMIN only)

The "Tenant" tab (visible only to ADMIN) SHALL expose a form to edit the tenant `name`. The form MUST use `useActionState` and follow the same validation/feedback pattern as the branch form. The backend endpoint MUST enforce ADMIN role.

#### Scenario: ADMIN updates tenant name
- **WHEN** an ADMIN changes the tenant name and submits
- **THEN** the form calls `PATCH /api/admin/tenants/me` with the new name, receives 200, and the `tenantSettings` slice updates

#### Scenario: Non-admin attempts access via URL
- **WHEN** a MANAGER navigates to `/settings?tab=tenant`
- **THEN** the tab is NOT rendered (fallback to first allowed tab) and no API call is made

### Requirement: Settings store and services

The Dashboard SHALL include a Zustand store `settingsStore` exposing selectors for `branchSettings`, `tenantSettings`, `isLoadingBranch`, `isLoadingTenant`, and action functions `fetchBranchSettings(branchId)`, `updateBranchSettings(branchId, patch)`, `fetchTenantSettings()`, `updateTenantSettings(patch)`. Consumers MUST use selectors with `useShallow` for objects and MUST NOT destructure the store.

#### Scenario: Fetch branch settings
- **WHEN** the branch tab mounts with `selectedBranchId`
- **THEN** `fetchBranchSettings(selectedBranchId)` is called, `isLoadingBranch` becomes `true`, the API returns the branch settings, and the store populates `branchSettings`

#### Scenario: Update branch settings updates store
- **WHEN** `updateBranchSettings` succeeds
- **THEN** the returned payload replaces `branchSettings` in the store and any subscribed component re-renders with the new data

#### Scenario: Branch switch clears settings
- **WHEN** the user switches branch via the BranchSwitcher
- **THEN** the settings slice for the previous branch is cleared and the next fetch targets the new `selectedBranchId`

### Requirement: Help content for each tab

Each settings tab SHALL have a `HelpButton` whose content is registered in `utils/helpContent.tsx` with a section describing the purpose of the tab, the fields, and common gotchas (especially the slug change impact and the 2FA device-loss scenario).

#### Scenario: User clicks HelpButton on Sucursal tab
- **WHEN** the user clicks the help icon in the Sucursal tab header
- **THEN** the help drawer opens showing sections "Datos generales", "Slug del menú público", "Horarios de atención"

#### Scenario: Help content for 2FA explains recovery
- **WHEN** the user opens the Perfil tab help
- **THEN** the help content includes a note that losing the 2FA device requires contacting an ADMIN to reset it from the database
