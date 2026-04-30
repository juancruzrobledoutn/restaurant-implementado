/**
 * Auth domain types for the Dashboard.
 *
 * Convention: IDs are strings in the frontend.
 * Backend returns numeric IDs — convert at the API boundary (in authStore).
 */

/** Authenticated user object as stored in authStore. */
export interface User {
  /** User ID — string in frontend, number in backend */
  id: string
  email: string
  fullName: string
  /** Tenant this user belongs to */
  tenantId: string
  /** IDs of branches this user has access to */
  branchIds: string[]
  /** Role names: ADMIN | MANAGER | KITCHEN | WAITER */
  roles: string[]
  /** Whether the user has 2FA enabled — synced from backend on login and after verify/disable */
  totpEnabled: boolean
}

/** Payload sent to POST /api/auth/login */
export interface LoginRequest {
  email: string
  password: string
  /** Optional TOTP code — sent when the backend indicated requires_2fa */
  totp_code?: string
}

/** Successful response from POST /api/auth/login */
export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  user: LoginResponseUser
}

/** User object as returned by the backend — IDs are numbers */
export interface LoginResponseUser {
  id: number
  email: string
  full_name: string
  tenant_id: number
  branch_ids: number[]
  roles: string[]
  is_2fa_enabled: boolean
}

/** Response when the backend requires 2FA before issuing a token */
export interface Requires2FAResponse {
  requires_2fa: true
  message: string
}

/** Response from POST /api/auth/refresh */
export interface RefreshResponse {
  access_token: string
  token_type: 'bearer'
}

/** Response from GET /api/auth/me */
export interface MeResponse {
  id: number
  email: string
  full_name: string
  tenant_id: number
  branch_ids: number[]
  roles: string[]
  is_2fa_enabled: boolean
}
