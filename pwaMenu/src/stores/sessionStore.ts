/**
 * Session store for pwaMenu.
 *
 * Persists Table Token HMAC with 8-hour TTL via manual localStorage writes.
 * Does NOT use Zustand persist middleware (no native TTL support).
 *
 * Patterns: selectores exportados, EMPTY values estables, no destructuring.
 */
import { create } from 'zustand'
import { readJSON, writeJSON, removeKey } from '../utils/storage'
import { logger } from '../utils/logger'

const STORAGE_KEY = 'pwamenu-session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

export type TableStatus = 'OPEN' | 'PAYING' | 'CLOSED'

export interface ActivatePayload {
  token: string
  branchSlug: string
  tableCode: string
  sessionId?: string | null
  dinerId?: string | null
  dinerName?: string | null
}

interface PersistedSession {
  token: string
  branchSlug: string
  tableCode: string
  sessionId: string | null
  dinerId: string | null
  dinerName: string | null
  expiresAt: number
}

interface SessionState {
  token: string | null
  branchSlug: string | null
  tableCode: string | null
  sessionId: string | null
  dinerId: string | null
  dinerName: string | null
  tableStatus: TableStatus
  expiresAt: number | null
  // actions
  activate: (payload: ActivatePayload) => void
  setSessionId: (id: string) => void
  setTableStatus: (status: TableStatus) => void
  setDinerInfo: (dinerId: string, dinerName: string) => void
  clear: () => void
  isExpired: () => boolean
}

// Read from localStorage synchronously at module load so components have
// the correct session on their FIRST render — before any useEffect runs.
// Guards like `if (!token)` would redirect prematurely without this.
function loadInitialSession(): Partial<Omit<SessionState, 'activate' | 'setSessionId' | 'setTableStatus' | 'setDinerInfo' | 'clear' | 'isExpired'>> {
  try {
    const stored = readJSON<PersistedSession>(STORAGE_KEY)
    if (!stored || !stored.token || !stored.branchSlug || !stored.tableCode) return {}
    if (Date.now() > stored.expiresAt) {
      removeKey(STORAGE_KEY)
      return {}
    }
    return {
      token: stored.token,
      branchSlug: stored.branchSlug,
      tableCode: stored.tableCode,
      sessionId: stored.sessionId ?? null,
      dinerId: stored.dinerId ?? null,
      dinerName: stored.dinerName ?? null,
      expiresAt: stored.expiresAt,
    }
  } catch {
    return {}
  }
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  token: null,
  branchSlug: null,
  tableCode: null,
  sessionId: null,
  dinerId: null,
  dinerName: null,
  tableStatus: 'OPEN',
  expiresAt: null,
  ...loadInitialSession(),

  activate(payload) {
    const expiresAt = Date.now() + SESSION_TTL_MS
    const next: PersistedSession = {
      token: payload.token,
      branchSlug: payload.branchSlug,
      tableCode: payload.tableCode,
      sessionId: payload.sessionId ?? null,
      dinerId: payload.dinerId ?? null,
      dinerName: payload.dinerName ?? null,
      expiresAt,
    }
    set({
      token: next.token,
      branchSlug: next.branchSlug,
      tableCode: next.tableCode,
      sessionId: next.sessionId,
      dinerId: next.dinerId,
      dinerName: next.dinerName,
      expiresAt,
    })
    writeJSON(STORAGE_KEY, next)
    logger.info('Session activated', { branchSlug: next.branchSlug, tableCode: next.tableCode })
  },

  setSessionId(id) {
    set({ sessionId: id })
    const state = get()
    if (state.token && state.branchSlug && state.tableCode && state.expiresAt) {
      writeJSON(STORAGE_KEY, {
        token: state.token,
        branchSlug: state.branchSlug,
        tableCode: state.tableCode,
        sessionId: id,
        dinerId: state.dinerId,
        dinerName: state.dinerName,
        expiresAt: state.expiresAt,
      } satisfies PersistedSession)
    }
  },

  setTableStatus(status) {
    set({ tableStatus: status })
    logger.info('Table status changed', { status })
  },

  setDinerInfo(dinerId, dinerName) {
    set({ dinerId, dinerName })
    const state = get()
    if (state.token && state.branchSlug && state.tableCode && state.expiresAt) {
      writeJSON(STORAGE_KEY, {
        token: state.token,
        branchSlug: state.branchSlug,
        tableCode: state.tableCode,
        sessionId: state.sessionId,
        dinerId,
        dinerName,
        expiresAt: state.expiresAt,
      } satisfies PersistedSession)
    }
  },

  clear() {
    set({
      token: null,
      branchSlug: null,
      tableCode: null,
      sessionId: null,
      dinerId: null,
      dinerName: null,
      tableStatus: 'OPEN',
      expiresAt: null,
    })
    removeKey(STORAGE_KEY)
    logger.info('Session cleared')
  },

  isExpired() {
    const { expiresAt } = get()
    return expiresAt === null || Date.now() > expiresAt
  },
}))

// ---- Selectors ----

export const selectToken = (s: SessionState) => s.token
export const selectBranchSlug = (s: SessionState) => s.branchSlug
export const selectTableCode = (s: SessionState) => s.tableCode
export const selectSessionId = (s: SessionState) => s.sessionId
export const selectDinerId = (s: SessionState) => s.dinerId
export const selectDinerName = (s: SessionState) => s.dinerName
export const selectTableStatus = (s: SessionState) => s.tableStatus
export const selectExpiresAt = (s: SessionState) => s.expiresAt
export const selectIsActive = (s: SessionState) => s.token !== null && !s.isExpired()
export const selectIsPaying = (s: SessionState) => s.tableStatus === 'PAYING'

// ---- Hydration helper ----

/**
 * Reads persisted session from localStorage.
 * Returns the data if valid, null if missing or expired.
 */
export function hydrateSessionFromStorage(): PersistedSession | null {
  const stored = readJSON<PersistedSession>(STORAGE_KEY)
  if (!stored) return null
  if (!stored.token || !stored.branchSlug || !stored.tableCode) return null
  if (Date.now() > stored.expiresAt) {
    removeKey(STORAGE_KEY)
    return null
  }
  // Backfill fields from older persisted versions
  return {
    ...stored,
    dinerId: stored.dinerId ?? null,
    dinerName: stored.dinerName ?? null,
  }
}
