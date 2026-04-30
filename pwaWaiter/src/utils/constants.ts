/**
 * Application-wide constants for pwaWaiter.
 *
 * Zustand rule: NEVER use inline `?? []` in selectors.
 * Use these stable EMPTY_* references instead.
 */

// ---------------------------------------------------------------------------
// Stable empty array fallbacks — prevent re-renders from new array references
// ---------------------------------------------------------------------------

export const EMPTY_ARRAY: readonly never[] = []

export const EMPTY_STRING_ARRAY: string[] = []

// ---------------------------------------------------------------------------
// Auth timing constants
// ---------------------------------------------------------------------------

/** Proactive refresh interval — 14 minutes in ms (token expires at 15 min) */
export const REFRESH_INTERVAL_MS = 840_000

/**
 * Total jitter window in ms for proactive refresh.
 * The actual interval is REFRESH_INTERVAL_MS ± REFRESH_JITTER_MS/2,
 * i.e. 14 min ± 2 min with REFRESH_JITTER_MS = 240_000.
 */
export const REFRESH_JITTER_MS = 240_000

/** Show idle warning after 25 minutes of inactivity */
export const IDLE_WARNING_MS = 1_500_000

/** Force logout after 30 minutes of inactivity */
export const IDLE_LOGOUT_MS = 1_800_000

// ---------------------------------------------------------------------------
// Storage keys — all localStorage keys in one place
// ---------------------------------------------------------------------------

export const STORAGE_KEYS = {
  /** Persisted branch selection from pre-login flow */
  BRANCH_SELECTION: 'pwawaiter-branch-selection',
} as const

// ---------------------------------------------------------------------------
// WebSocket reconnect tuning
// ---------------------------------------------------------------------------

/** Maximum backoff between reconnect attempts */
export const WS_RECONNECT_MAX_MS = 30_000

/** Base delay for exponential backoff */
export const WS_RECONNECT_BASE_MS = 1_000

/** Extra random jitter added to each reconnect delay */
export const WS_RECONNECT_JITTER_MS = 500
