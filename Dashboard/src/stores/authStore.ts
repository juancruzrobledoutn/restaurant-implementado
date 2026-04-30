/**
 * authStore — JWT authentication state for the Dashboard.
 *
 * Rules enforced (zustand-store-pattern skill):
 * - NEVER destructure: use named selectors
 * - EMPTY_STRING_ARRAY for stable array fallbacks
 * - Access token is in-memory ONLY — NOT in Zustand state to avoid re-renders
 *
 * Token lifecycle:
 * 1. login() → POST /api/auth/login → store access_token in memory, start refresh interval
 * 2. setInterval every 14 min → POST /api/auth/refresh → update in-memory token
 * 3. logout() → set isLoggingOut → POST /api/auth/logout → clear everything
 * 4. fetchAPI 401 → checks isLoggingOut before refresh
 */

import { create } from 'zustand'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import { registerAuthStore } from '@/services/api'
import { EMPTY_STRING_ARRAY, REFRESH_INTERVAL_MS } from '@/utils/constants'
import type { User, LoginRequest, LoginResponse, RefreshResponse, Requires2FAResponse } from '@/types/auth'

/** Jitter range: ±2 minutes (in ms) to prevent thundering herd */
const REFRESH_JITTER_MS = 120_000

// ---------------------------------------------------------------------------
// In-memory token (NOT in Zustand state — no re-renders on refresh)
// ---------------------------------------------------------------------------
let _accessToken: string | null = null
let _refreshIntervalId: ReturnType<typeof setInterval> | null = null

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------
interface AuthState {
  isAuthenticated: boolean
  user: User | null
  isLoading: boolean
  error: string | null
  requires2fa: boolean
  isLoggingOut: boolean

  // Actions
  login: (email: string, password: string, totpCode?: string) => Promise<void>
  logout: () => Promise<void>
  clearError: () => void
  /** Update the in-memory user's totpEnabled flag after 2FA verify or disable */
  setTotpEnabled: (enabled: boolean) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export const useAuthStore = create<AuthState>()((set, get) => ({
  // Initial state — unauthenticated
  isAuthenticated: false,
  user: null,
  isLoading: false,
  error: null,
  requires2fa: false,
  isLoggingOut: false,

  // ------------------------------------------------------------------
  // login
  // ------------------------------------------------------------------
  login: async (email: string, password: string, totpCode?: string) => {
    set({ isLoading: true, error: null, requires2fa: false })

    try {
      const body: LoginRequest = { email, password }
      if (totpCode) body.totp_code = totpCode

      const response = await fetch(`${env.API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // HttpOnly refresh cookie
        body: JSON.stringify(body),
      })

      const responseBody = (await response.json()) as LoginResponse | Requires2FAResponse | { detail?: string }

      if (response.status === 200) {
        // requires_2fa can come with status 200 — check before casting to LoginResponse
        if ('requires_2fa' in responseBody && (responseBody as Requires2FAResponse).requires_2fa) {
          set({ requires2fa: true, isLoading: false })
          return
        }

        const data = responseBody as LoginResponse

        // Convert backend number IDs to strings at the boundary
        const user: User = {
          id: String(data.user.id),
          email: data.user.email,
          fullName: data.user.full_name,
          tenantId: String(data.user.tenant_id),
          branchIds: data.user.branch_ids.map(String),
          roles: data.user.roles,
          totpEnabled: data.user.is_2fa_enabled,
        }

        _accessToken = data.access_token
        _startRefreshInterval()

        set({ isAuthenticated: true, user, isLoading: false, error: null })
        logger.info('authStore: login successful', { email })
        return
      }

      // Check for requires_2fa (backend may return 200 or non-200 with this flag)
      if ('requires_2fa' in responseBody && (responseBody as Requires2FAResponse).requires_2fa) {
        logger.info('authStore: 2FA required')
        set({ requires2fa: true, isLoading: false })
        return
      }

      if (response.status === 401) {
        set({ error: 'Credenciales incorrectas. Verificá tu email y contraseña.', isLoading: false })
        return
      }

      if (response.status === 429) {
        set({ error: 'Demasiados intentos fallidos. Intentá de nuevo en unos minutos.', isLoading: false })
        return
      }

      const detail = (responseBody as { detail?: string }).detail ?? 'Error al iniciar sesión'
      set({ error: detail, isLoading: false })

    } catch (err) {
      logger.error('authStore: login error', err)
      set({ error: 'Error de conexión. Verificá tu conexión a internet.', isLoading: false })
    }
  },

  // ------------------------------------------------------------------
  // logout
  // ------------------------------------------------------------------
  logout: async () => {
    if (get().isLoggingOut) return

    set({ isLoggingOut: true })
    _stopRefreshInterval()

    try {
      await fetch(`${env.API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ..._accessToken ? { Authorization: `Bearer ${_accessToken}` } : {},
        },
        credentials: 'include',
      })
      logger.info('authStore: logout successful')
    } catch (err) {
      // Log but don't block — we clear state regardless
      logger.warn('authStore: logout request failed', err)
    } finally {
      _accessToken = null

      // Clear branch selection on logout (C-15)
      // Lazy import to avoid circular dependency
      import('@/stores/branchStore').then(({ useBranchStore }) => {
        useBranchStore.getState().setSelectedBranchId(null)
      }).catch(() => {
        // Ignore if not loaded yet
      })

      set({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: null,
        requires2fa: false,
        isLoggingOut: false,
      })
    }
  },

  clearError: () => set({ error: null }),

  setTotpEnabled: (enabled: boolean) => {
    const user = get().user
    if (!user) return
    set({ user: { ...user, totpEnabled: enabled } })
  },
}))

// ---------------------------------------------------------------------------
// Proactive refresh
// ---------------------------------------------------------------------------

function _startRefreshInterval(): void {
  _stopRefreshInterval()

  // Apply jitter: REFRESH_INTERVAL_MS ± REFRESH_JITTER_MS to prevent thundering herd
  const jitter = Math.floor(Math.random() * 2 * REFRESH_JITTER_MS) - REFRESH_JITTER_MS
  const intervalMs = REFRESH_INTERVAL_MS + jitter

  logger.debug(`authStore: refresh interval set to ${Math.round(intervalMs / 1000)}s`)

  _refreshIntervalId = setInterval(async () => {
    // Guard: skip if logging out
    if (useAuthStore.getState().isLoggingOut) {
      logger.debug('authStore: skipping refresh — logout in progress')
      return
    }

    try {
      const response = await fetch(`${env.API_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        logger.warn('authStore: proactive refresh failed — logging out')
        await useAuthStore.getState().logout()
        return
      }

      const data = (await response.json()) as RefreshResponse
      _accessToken = data.access_token
      logger.debug('authStore: proactive refresh successful')
    } catch (err) {
      logger.error('authStore: proactive refresh threw', err)
      await useAuthStore.getState().logout()
    }
  }, intervalMs)
}

function _stopRefreshInterval(): void {
  if (_refreshIntervalId !== null) {
    clearInterval(_refreshIntervalId)
    _refreshIntervalId = null
  }
}

// ---------------------------------------------------------------------------
// Register with fetchAPI (avoids circular import — resolved at runtime)
// ---------------------------------------------------------------------------
registerAuthStore({
  getAccessToken: () => _accessToken,
  isLoggingOut: () => useAuthStore.getState().isLoggingOut,
  logout: () => useAuthStore.getState().logout(),
  setAccessToken: (token: string) => { _accessToken = token },
})

// ---------------------------------------------------------------------------
// Named selectors — NEVER destructure; always use these
// ---------------------------------------------------------------------------
export const selectIsAuthenticated = (s: AuthState) => s.isAuthenticated
export const selectUser = (s: AuthState) => s.user
export const selectIsLoading = (s: AuthState) => s.isLoading
export const selectError = (s: AuthState) => s.error
export const selectRequires2fa = (s: AuthState) => s.requires2fa
export const selectIsLoggingOut = (s: AuthState) => s.isLoggingOut
export const selectLogin = (s: AuthState) => s.login
export const selectLogout = (s: AuthState) => s.logout
export const selectClearError = (s: AuthState) => s.clearError
export const selectSetTotpEnabled = (s: AuthState) => s.setTotpEnabled

// Stable array fallback for user.branchIds
export const selectUserBranchIds = (s: AuthState) =>
  s.user?.branchIds ?? EMPTY_STRING_ARRAY

export const selectUserRoles = (s: AuthState) =>
  s.user?.roles ?? EMPTY_STRING_ARRAY

/** Exposes the in-memory token for fetchAPI. Not a Zustand selector — no reactivity. */
export function getAccessToken(): string | null {
  return _accessToken
}
