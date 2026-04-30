## ADDED Requirements

### Requirement: authStore manages JWT authentication state

The Dashboard SHALL provide a Zustand store (`authStore`) that manages authentication state including `isAuthenticated` (boolean), `user` (object with id, email, fullName, tenantId, branchIds, roles — all as strings except roles which is string[]), `isLoading` (boolean), and `error` (string | null). The store SHALL export named selectors for each state property. The store SHALL NOT be destructured — consumers MUST use selectors.

#### Scenario: Initial state is unauthenticated
- **WHEN** the authStore is initialized
- **THEN** `isAuthenticated` SHALL be `false`, `user` SHALL be `null`, `isLoading` SHALL be `false`, `error` SHALL be `null`

#### Scenario: Selector usage is enforced
- **WHEN** a component reads from authStore
- **THEN** it SHALL use named selectors (e.g., `useAuthStore(selectUser)`) and SHALL NOT destructure the store

### Requirement: Login action authenticates user via backend

The authStore SHALL provide a `login(email, password, totpCode?)` action that sends a POST request to `/api/auth/login`. On success, the store SHALL update `isAuthenticated` to `true`, store the `user` object (converting backend `number` IDs to `string`), and store the access token in memory (not localStorage). On failure, the store SHALL set `error` with the error message.

#### Scenario: Successful login without 2FA
- **WHEN** `login("admin@test.com", "validPassword")` is called
- **THEN** the store SHALL POST to `/api/auth/login` with `{ email, password }`
- **AND** on HTTP 200 with `access_token` and `user`, the store SHALL set `isAuthenticated` to `true`, store the user object, and start the proactive refresh interval

#### Scenario: Login requires 2FA
- **WHEN** `login("admin@test.com", "validPassword")` is called and the response contains `{ requires_2fa: true }`
- **THEN** the store SHALL set a `requires2fa` flag to `true` without setting `isAuthenticated`
- **AND** the UI SHALL display a TOTP input field

#### Scenario: Login with 2FA code
- **WHEN** `login("admin@test.com", "validPassword", "123456")` is called with a valid TOTP code
- **THEN** the store SHALL POST to `/api/auth/login` with `{ email, password, totp_code }` and complete login normally

#### Scenario: Login failure with invalid credentials
- **WHEN** `login("admin@test.com", "wrongPassword")` is called and the backend returns HTTP 401
- **THEN** the store SHALL set `error` to the error message from the response and `isAuthenticated` SHALL remain `false`

#### Scenario: Login failure with rate limiting
- **WHEN** `login()` is called and the backend returns HTTP 429
- **THEN** the store SHALL set `error` to a user-friendly rate limit message

### Requirement: Proactive token refresh every 14 minutes

After successful login, the authStore SHALL start a `setInterval` that calls `POST /api/auth/refresh` every 14 minutes (840,000 ms). The refresh endpoint uses the HttpOnly cookie automatically. On success, the new access token SHALL replace the old one in memory. On failure, the store SHALL trigger logout.

#### Scenario: Refresh succeeds silently
- **WHEN** the 14-minute interval fires
- **THEN** the store SHALL POST to `/api/auth/refresh` and update the in-memory access token with the new one from the response

#### Scenario: Refresh fails (expired or revoked)
- **WHEN** the refresh request returns HTTP 401
- **THEN** the store SHALL call `logout()` to clear authentication state

#### Scenario: Refresh interval is cleared on logout
- **WHEN** `logout()` is called
- **THEN** the `setInterval` for proactive refresh SHALL be cleared

### Requirement: Logout with infinite-loop prevention

The authStore SHALL provide a `logout()` action that sets an `isLoggingOut` flag, sends POST to `/api/auth/logout`, clears all auth state (`isAuthenticated`, `user`, access token), and clears the refresh interval. The `isLoggingOut` flag SHALL prevent the 401 interceptor and refresh interval from triggering re-authentication during logout.

#### Scenario: Successful logout
- **WHEN** `logout()` is called
- **THEN** the store SHALL set `isLoggingOut` to `true`, POST to `/api/auth/logout`, clear `isAuthenticated` to `false`, clear `user` to `null`, clear the access token, clear the refresh interval, and redirect to `/login`

#### Scenario: Logout prevents refresh loop
- **WHEN** `logout()` is in progress and the logout request itself returns 401
- **THEN** the 401 interceptor SHALL check `isLoggingOut` and skip the refresh retry

#### Scenario: Logout prevents interval refresh
- **WHEN** `logout()` is in progress and the refresh interval fires
- **THEN** the interval callback SHALL check `isLoggingOut` and skip the refresh

### Requirement: fetchAPI with auth header and 401 interceptor

The Dashboard SHALL provide a `fetchAPI` function in `services/api.ts` that wraps native `fetch`. It SHALL auto-attach the `Authorization: Bearer {token}` header from the authStore's in-memory token. On HTTP 401 responses, it SHALL attempt a single silent refresh via `POST /api/auth/refresh` and retry the original request. If the retry also fails, it SHALL trigger logout.

#### Scenario: Authenticated request includes Bearer token
- **WHEN** `fetchAPI("/api/admin/categories")` is called while authenticated
- **THEN** the request SHALL include `Authorization: Bearer {accessToken}` header and `Content-Type: application/json`

#### Scenario: 401 triggers silent refresh and retry
- **WHEN** a request returns HTTP 401 and `isLoggingOut` is false
- **THEN** fetchAPI SHALL POST to `/api/auth/refresh`, update the access token, and retry the original request exactly once

#### Scenario: Second 401 triggers logout
- **WHEN** the retried request after refresh also returns HTTP 401
- **THEN** fetchAPI SHALL call `logout()` from authStore and NOT retry again

#### Scenario: Non-401 errors are thrown
- **WHEN** a request returns HTTP 400, 403, 404, or 500
- **THEN** fetchAPI SHALL throw an error with the response detail message without attempting refresh

### Requirement: Login page with email, password, and optional TOTP

The Dashboard SHALL provide a Login page at route `/login` with email and password fields. When the backend response indicates `requires_2fa: true`, the page SHALL display an additional TOTP code input field. The page SHALL display error messages from the authStore. The page SHALL redirect to `/` on successful login.

#### Scenario: Login page renders form fields
- **WHEN** navigating to `/login`
- **THEN** the page SHALL display email input, password input, and a submit button with text from i18n

#### Scenario: TOTP field appears when required
- **WHEN** the login response sets `requires2fa` to true in authStore
- **THEN** the page SHALL display an additional 6-digit TOTP code input field

#### Scenario: Redirect after successful login
- **WHEN** login succeeds and `isAuthenticated` becomes true
- **THEN** the page SHALL redirect to `/` (or the previously requested URL if available)

#### Scenario: Error message display
- **WHEN** the authStore `error` is set
- **THEN** the page SHALL display the error message in a visible alert component

### Requirement: Protected routes redirect unauthenticated users

The Dashboard SHALL provide a `ProtectedRoute` component that checks `isAuthenticated` from authStore. Unauthenticated users SHALL be redirected to `/login`. The `/login` route itself SHALL NOT be protected.

#### Scenario: Unauthenticated user accessing protected route
- **WHEN** a user who is not authenticated navigates to `/`
- **THEN** they SHALL be redirected to `/login`

#### Scenario: Authenticated user accessing protected route
- **WHEN** an authenticated user navigates to `/`
- **THEN** they SHALL see the Home page inside the MainLayout

#### Scenario: Authenticated user accessing login page
- **WHEN** an authenticated user navigates to `/login`
- **THEN** they SHALL be redirected to `/`

### Requirement: useIdleTimeout hook monitors user activity

The Dashboard SHALL provide a `useIdleTimeout` hook that monitors `mousemove`, `keydown`, `touchstart`, and `click` events on `document`. After 25 minutes of inactivity, it SHALL display a warning modal. After 30 minutes of inactivity, it SHALL force logout via authStore.

#### Scenario: Warning modal at 25 minutes
- **WHEN** no user activity is detected for 25 minutes
- **THEN** a warning modal SHALL appear informing the user they will be logged out in 5 minutes

#### Scenario: Activity resets the timer
- **WHEN** the warning modal is displayed and the user moves the mouse or presses a key
- **THEN** the idle timer SHALL reset and the warning modal SHALL close

#### Scenario: Force logout at 30 minutes
- **WHEN** no user activity is detected for 30 minutes (including during the warning period)
- **THEN** the hook SHALL call `logout()` from authStore

#### Scenario: Hook is only active when authenticated
- **WHEN** `isAuthenticated` is false
- **THEN** the idle timeout listeners SHALL NOT be active
