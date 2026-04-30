/**
 * authAPI — HTTP client for auth-related endpoints (C-28).
 *
 * Extends auth functionality beyond the core authStore:
 *   - changePassword (POST /api/auth/change-password)
 *   - setup2FA      (POST /api/auth/2fa/setup)
 *   - verify2FA     (POST /api/auth/2fa/verify)
 *   - disable2FA    (POST /api/auth/2fa/disable)
 *
 * Note: These endpoints are NOT in authStore because they are transient UI
 * operations (not global state). Components call these directly.
 */

import { fetchAPI } from '@/services/api'

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------

export interface ChangePasswordPayload {
  currentPassword: string
  newPassword: string
}

export async function changePassword(payload: ChangePasswordPayload): Promise<{ detail: string }> {
  return fetchAPI<{ detail: string }>('/api/auth/change-password', {
    method: 'POST',
    body: {
      current_password: payload.currentPassword,
      new_password: payload.newPassword,
    },
  })
}

// ---------------------------------------------------------------------------
// 2FA — these wrap existing endpoints from C-03
// ---------------------------------------------------------------------------

export interface TwoFactorSetupResponse {
  secret: string
  provisioning_uri: string
}

export async function setup2FA(): Promise<TwoFactorSetupResponse> {
  return fetchAPI<TwoFactorSetupResponse>('/api/auth/2fa/setup', { method: 'POST' })
}

export async function verify2FA(code: string): Promise<{ detail: string }> {
  return fetchAPI<{ detail: string }>('/api/auth/2fa/verify', {
    method: 'POST',
    body: { totp_code: code },
  })
}

export async function disable2FA(code: string): Promise<{ detail: string }> {
  return fetchAPI<{ detail: string }>('/api/auth/2fa/disable', {
    method: 'POST',
    body: { totp_code: code },
  })
}
