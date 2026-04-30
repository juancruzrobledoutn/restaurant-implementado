/**
 * authStore — JWT authentication state for pwaWaiter.
 *
 * Rules enforced (zustand-store-pattern skill):
 * - NEVER destructure — use named selectors
 * - EMPTY_STRING_ARRAY for stable fallbacks on branchIds / roles
 * - Access token is in-memory ONLY — NOT in Zustand state, NOT in localStorage
 *
 * Token lifecycle:
 * 1. login() → POST /api/auth/login → store access_token in memory, schedule
 *    proactive refresh with jitter
 * 2. _scheduleRefresh() → setTimeout at 14min ± 2min → POST /api/auth/refresh
 *    → update in-memory token → reschedule
 * 3. logout() → set isLoggingOut → POST /api/auth/logout → clear everything
 * 4. fetchAPI 401 → attemptRefresh() (with mutex) → retry the original request
 *
 * Post-login assignment:
 *   setAssignment(sectorId, sectorName) stores the waiter's sector for today
 *   (filled by usePostLoginVerify after GET /api/waiter/verify-branch-assignment).
 */

import { create } from 'zustand'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import { registerAuthStore } from '@/services/api'
import {
  EMPTY_STRING_ARRAY,
  REFRESH_INTERVAL_MS,
  REFRESH_JITTER_MS,
} from '@/utils/constants'
import type {
  User,
  LoginRequest,
  LoginResponse,
  RefreshResponse,
  Requires2FAResponse,
} from '@/types/auth'

// ---------------------------------------------------------------------------
// In-memory token (NOT in Zustand state — no re-renders on refresh)
// ---------------------------------------------------------------------------
let _accessToken: string | null = null
let _refreshTimerId: ReturnType<typeof setTimeout> | null = null

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

  /** Sector assigned to the waiter today (set by usePostLoginVerify). */
  assignedSectorId: string | null
  assignedSectorName: string | null

  // Actions
  login: (email: string, password: string, totpCode?: string) => Promise<void>
  logout: () => Promise<void>
  clearError: () => void
  setAssignment: (sectorId: string, sectorName: string) => void
  clearAssignment: () => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export const useAuthStore = create<AuthState>()((set, get) => ({
  isAuthenticated: false,
  user: null,
  isLoading: false,
  error: null,
  requires2fa: false,
  isLoggingOut: false,
  assignedSectorId: null,
  assignedSectorName: null,

  // ------------------------------------------------------------------
  // login
  // ------------------------------------------------------------------
  login: async (email, password, totpCode) => {
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

      const responseBody = (await response.json().catch(() => ({}))) as
        | LoginResponse
        | Requires2FAResponse
        | { detail?: string }

      if (response.status === 200) {
        // 2FA check — may come with status 200 before authentication completes
        if (
          'requires_2fa' in responseBody &&
          (responseBody as Requires2FAResponse).requires_2fa
        ) {
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
        }

        _accessToken = data.access_token
        _scheduleRefresh()

        set({ isAuthenticated: true, user, isLoading: false, error: null })
        logger.info('authStore: login successful', { email })
        return
      }

      // Some backends may return non-200 with requires_2fa
      if (
        'requires_2fa' in responseBody &&
        (responseBody as Requires2FAResponse).requires_2fa
      ) {
        logger.info('authStore: 2FA required')
        set({ requires2fa: true, isLoading: false })
        return
      }

      if (response.status === 401) {
        set({
          error: 'Credenciales incorrectas. Verificá tu email y contraseña.',
          isLoading: false,
        })
        return
      }

      if (response.status === 429) {
        set({
          error: 'Demasiados intentos fallidos. Intentá de nuevo en unos minutos.',
          isLoading: false,
        })
        return
      }

      const detail =
        (responseBody as { detail?: string }).detail ?? 'Error al iniciar sesión'
      set({ error: detail, isLoading: false })
    } catch (err) {
      logger.error('authStore: login error', err)
      set({
        error: 'Error de conexión. Verificá tu conexión a internet.',
        isLoading: false,
      })
    }
  },

  // ------------------------------------------------------------------
  // logout
  // ------------------------------------------------------------------
  logout: async () => {
    if (get().isLoggingOut) return

    set({ isLoggingOut: true })
    _stopRefresh()

    try {
      await fetch(`${env.API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(_accessToken ? { Authorization: `Bearer ${_accessToken}` } : {}),
        },
        credentials: 'include',
      })
      logger.info('authStore: logout successful')
    } catch (err) {
      // Log but don't block — we clear state regardless
      logger.warn('authStore: logout request failed', err)
    } finally {
      _accessToken = null
      set({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: null,
        requires2fa: false,
        isLoggingOut: false,
        assignedSectorId: null,
        assignedSectorName: null,
      })
    }
  },

  clearError: () => set({ error: null }),

  setAssignment: (sectorId, sectorName) =>
    set({ assignedSectorId: sectorId, assignedSectorName: sectorName }),

  clearAssignment: () =>
    set({ assignedSectorId: null, assignedSectorName: null }),
}))

// ---------------------------------------------------------------------------
// Proactive refresh with jitter
// ---------------------------------------------------------------------------

function _scheduleRefresh(): void {
  _stopRefresh()

  // 14 min ± 2 min of jitter (REFRESH_JITTER_MS total window = 4 min spread)
  const jitter = (Math.random() - 0.5) * REFRESH_JITTER_MS
  const delay = REFRESH_INTERVAL_MS + jitter

  _refreshTimerId = setTimeout(async () => {
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

      // Schedule the next refresh recursively (with new jitter)
      _scheduleRefresh()
    } catch (err) {
      logger.error('authStore: proactive refresh threw', err)
      await useAuthStore.getState().logout()
    }
  }, delay)
}

function _stopRefresh(): void {
  if (_refreshTimerId !== null) {
    clearTimeout(_refreshTimerId)
    _refreshTimerId = null
  }
}

// ---------------------------------------------------------------------------
// Register with fetchAPI (avoids circular import)
// ---------------------------------------------------------------------------
registerAuthStore({
  getAccessToken: () => _accessToken,
  isLoggingOut: () => useAuthStore.getState().isLoggingOut,
  logout: () => useAuthStore.getState().logout(),
  setAccessToken: (token: string) => {
    _accessToken = token
  },
})

// ---------------------------------------------------------------------------
// Selectors — NEVER destructure; always use these
// ---------------------------------------------------------------------------
export const selectIsAuthenticated = (s: AuthState) => s.isAuthenticated
export const selectUser = (s: AuthState) => s.user
export const selectIsLoading = (s: AuthState) => s.isLoading
export const selectError = (s: AuthState) => s.error
export const selectRequires2fa = (s: AuthState) => s.requires2fa
export const selectIsLoggingOut = (s: AuthState) => s.isLoggingOut
export const selectAssignedSectorId = (s: AuthState) => s.assignedSectorId
export const selectAssignedSectorName = (s: AuthState) => s.assignedSectorName
export const selectLogin = (s: AuthState) => s.login
export const selectLogout = (s: AuthState) => s.logout
export const selectClearError = (s: AuthState) => s.clearError
export const selectSetAssignment = (s: AuthState) => s.setAssignment
export const selectClearAssignment = (s: AuthState) => s.clearAssignment

// Stable array fallbacks for user.branchIds / user.roles
export const selectUserBranchIds = (s: AuthState) =>
  s.user?.branchIds ?? EMPTY_STRING_ARRAY

export const selectUserRoles = (s: AuthState) =>
  s.user?.roles ?? EMPTY_STRING_ARRAY

/** Non-reactive access to the in-memory token (for waiterWsService.connect). */
export function getAccessToken(): string | null {
  return _accessToken
}

/** Test-only: reset module-level token + timer. Exported for test cleanup. */
export function __resetAuthModuleState(): void {
  _accessToken = null
  _stopRefresh()
}
