/**
 * Customer store for pwaMenu (C-19 / Task 6.3).
 *
 * Holds customer profile, visit history, and preferences.
 * Loaded lazily via load() — no auto-load on session start.
 *
 * IMPORTANT: NO localStorage persistence for this store.
 * Reason: profile contains PII (name, email) and consent state.
 * The data is cheap to re-fetch on app start and must not linger
 * in localStorage after opt-out or session clear.
 *
 * Patterns (NON-NEGOTIABLE):
 * - NEVER destructure from store — use selectors
 * - useShallow for object/array selectors
 * - EMPTY_ARRAY stable fallbacks
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { logger } from '../utils/logger'
import { customerApi, CustomerNotFoundError } from '../services/customerApi'
import type { CustomerProfile, VisitEntry, PreferenceEntry } from '../types/billing'

// --- Stable fallbacks ---
const EMPTY_VISITS: VisitEntry[] = []
const EMPTY_PREFERENCES: PreferenceEntry[] = []

// --- Store state interface ---

interface CustomerState {
  profile: CustomerProfile | null
  visitHistory: VisitEntry[]
  preferences: PreferenceEntry[]
  isLoading: boolean
  loadedAt: number | null // Unix ms
  error: string | null

  // Actions
  load: () => Promise<void>
  setProfile: (profile: CustomerProfile) => void
  reset: () => void
}

const initialState: Omit<CustomerState, 'load' | 'setProfile' | 'reset'> = {
  profile: null,
  visitHistory: EMPTY_VISITS,
  preferences: EMPTY_PREFERENCES,
  isLoading: false,
  loadedAt: null,
  error: null,
}

export const useCustomerStore = create<CustomerState>()((set) => ({
  ...initialState,

  /**
   * Load profile, visit history, and preferences in parallel.
   *
   * - Uses Promise.allSettled — partial success is acceptable.
   * - 404 on profile → profile=null (anonymous diner, not an error).
   * - Any other error → sets error message, keeps previous state intact.
   *
   * NO persistence: comment intentional — see file header.
   */
  async load() {
    set({ isLoading: true, error: null })

    const [profileResult, historyResult, prefsResult] = await Promise.allSettled([
      customerApi.getProfile(),
      customerApi.getHistory(),
      customerApi.getPreferences(),
    ])

    const updates: Partial<CustomerState> = {
      isLoading: false,
      loadedAt: Date.now(),
    }

    // Profile: CustomerNotFoundError (404) is graceful (anonymous diner)
    if (profileResult.status === 'fulfilled') {
      updates.profile = profileResult.value
    } else {
      const err = profileResult.reason
      if (err instanceof CustomerNotFoundError) {
        updates.profile = null
        logger.debug('customerStore.load: profile not found — anonymous diner')
      } else {
        logger.warn('customerStore.load: profile fetch failed', err)
        updates.error = 'Failed to load profile'
      }
    }

    // Visit history: failure is non-fatal
    if (historyResult.status === 'fulfilled') {
      updates.visitHistory = historyResult.value.length > 0
        ? historyResult.value
        : EMPTY_VISITS
    } else {
      logger.warn('customerStore.load: history fetch failed', historyResult.reason)
      updates.visitHistory = EMPTY_VISITS
    }

    // Preferences: failure is non-fatal
    if (prefsResult.status === 'fulfilled') {
      updates.preferences = prefsResult.value.length > 0
        ? prefsResult.value
        : EMPTY_PREFERENCES
    } else {
      logger.warn('customerStore.load: preferences fetch failed', prefsResult.reason)
      updates.preferences = EMPTY_PREFERENCES
    }

    set(updates)
    logger.info('customerStore.load: complete', {
      hasProfile: !!updates.profile,
      historyCount: updates.visitHistory?.length ?? 0,
      prefsCount: updates.preferences?.length ?? 0,
    })
  },

  /**
   * Set profile directly (e.g., after opt-in completes).
   */
  setProfile(profile: CustomerProfile) {
    set({ profile })
    logger.debug('customerStore.setProfile', { optedIn: profile.optedIn })
  },

  /**
   * Reset to initial state on session clear.
   * Does NOT wipe loadedAt — reset is explicit, not a cache miss.
   */
  reset() {
    set({ ...initialState })
    logger.info('customerStore.reset')
  },
}))

// ── Selectors ──────────────────────────────────────────────────────────────────

export const selectCustomerProfile = (s: CustomerState) => s.profile
export const selectIsCustomerLoading = (s: CustomerState) => s.isLoading
export const selectCustomerLoadedAt = (s: CustomerState) => s.loadedAt
export const selectCustomerError = (s: CustomerState) => s.error
export const selectOptedIn = (s: CustomerState) => s.profile?.optedIn ?? false

/**
 * Use with useShallow to avoid new reference on every render.
 */
export const selectVisitHistory = (s: CustomerState) => s.visitHistory
export const selectPreferences = (s: CustomerState) => s.preferences

export const useCustomerActions = () =>
  useCustomerStore(
    useShallow((s) => ({
      load: s.load,
      setProfile: s.setProfile,
      reset: s.reset,
    })),
  )
