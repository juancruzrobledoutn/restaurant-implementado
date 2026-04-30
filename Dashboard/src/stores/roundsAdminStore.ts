/**
 * roundsAdminStore — admin orders list state (C-25).
 *
 * Skill: zustand-store-pattern
 *
 * Design decisions:
 *   NO persist() — round states change in seconds; stale snapshots confuse managers.
 *   viewMode persists directly to localStorage (key: 'orders.viewMode') — done in the page.
 *
 * WS handlers evaluate _passesFilter before upsert/remove:
 *   - If round passes filter → ADD or UPDATE in place
 *   - If round does NOT pass (e.g., transitioned out of active status filter) → REMOVE
 *   - If round not in store and doesn't pass → IGNORE
 *
 * cancelRound: calls the API but does NOT mutate the store — it waits for the
 *   ROUND_CANCELED WS event to arrive and let the handler remove the round.
 *   On error it throws so the page can show a toast.
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { roundsAdminAPI } from '@/services/roundsAdminAPI'
import { handleError } from '@/utils/logger'
import type { Round, RoundFilters, RoundStatus } from '@/types/operations'
import type { WSEvent } from '@/types/menu'

// ---------------------------------------------------------------------------
// Stable fallback
// ---------------------------------------------------------------------------

export const EMPTY_ROUNDS: Round[] = []

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

interface RoundsAdminState {
  rounds: Round[]
  total: number
  filters: RoundFilters
  isLoading: boolean
  error: string | null
  pagination: { limit: number; offset: number }
  selectedRoundId: string | null

  // Actions
  fetchRounds: (filters: Partial<RoundFilters>) => Promise<void>
  setFilter: <K extends keyof RoundFilters>(key: K, value: RoundFilters[K] | undefined) => void
  clearFilters: () => void
  selectRound: (id: string | null) => void
  cancelRound: (id: string, cancelReason: string) => Promise<void>
  reset: () => void

  // WS handlers — one per ROUND_* event type
  handleRoundPending: (event: WSEvent) => void
  handleRoundConfirmed: (event: WSEvent) => void
  handleRoundSubmitted: (event: WSEvent) => void
  handleRoundInKitchen: (event: WSEvent) => void
  handleRoundReady: (event: WSEvent) => void
  handleRoundServed: (event: WSEvent) => void
  handleRoundCanceled: (event: WSEvent) => void
}

// ---------------------------------------------------------------------------
// Today's date in YYYY-MM-DD (used as default filter)
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useRoundsAdminStore = create<RoundsAdminState>()((set, get) => ({
  rounds: EMPTY_ROUNDS,
  total: 0,
  filters: {
    branch_id: '',
    date: todayISO(),
    limit: 50,
    offset: 0,
  },
  isLoading: false,
  error: null,
  pagination: { limit: 50, offset: 0 },
  selectedRoundId: null,

  fetchRounds: async (filters) => {
    set({ isLoading: true, error: null, filters: { ...get().filters, ...filters } })
    try {
      const response = await roundsAdminAPI.listRounds({ ...get().filters, ...filters })
      set({ rounds: response.items, total: response.total, isLoading: false })
    } catch (err) {
      set({
        isLoading: false,
        error: handleError(err, 'roundsAdminStore.fetchRounds'),
      })
    }
  },

  setFilter: (key, value) => {
    set((s) => ({
      filters: { ...s.filters, [key]: value },
    }))
  },

  clearFilters: () => {
    const { branch_id } = get().filters
    set({
      filters: {
        branch_id,
        date: todayISO(),
        limit: 50,
        offset: 0,
      },
    })
  },

  selectRound: (id) => set({ selectedRoundId: id }),

  cancelRound: async (id, cancelReason) => {
    // Throws on error so the caller can show a toast
    // Does NOT mutate store — waits for ROUND_CANCELED WS event
    await roundsAdminAPI.cancelRound(id, cancelReason)
  },

  reset: () => set({ rounds: EMPTY_ROUNDS, total: 0, isLoading: false, error: null }),

  // ── WS handlers ──────────────────────────────────────────────────────────

  handleRoundPending: (event) => {
    const round = _extractRound(event, 'PENDING')
    if (!round) return
    const { filters } = get()
    if (!_passesFilter(round, filters)) return
    set((s) => ({
      rounds: s.rounds.some((r) => r.id === round.id)
        ? s.rounds.map((r) => (r.id === round.id ? round : r))
        : [...s.rounds, round],
    }))
  },

  handleRoundConfirmed: (event) => {
    _handleTransition(event, 'CONFIRMED', set, get)
  },

  handleRoundSubmitted: (event) => {
    _handleTransition(event, 'SUBMITTED', set, get)
  },

  handleRoundInKitchen: (event) => {
    _handleTransition(event, 'IN_KITCHEN', set, get)
  },

  handleRoundReady: (event) => {
    _handleTransition(event, 'READY', set, get)
  },

  handleRoundServed: (event) => {
    _handleTransition(event, 'SERVED', set, get)
  },

  handleRoundCanceled: (event) => {
    const id = _extractId(event)
    if (!id) return
    set((s) => ({
      rounds: s.rounds.filter((r) => r.id !== id),
      selectedRoundId: s.selectedRoundId === id ? null : s.selectedRoundId,
    }))
  },
}))

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Extract the string ID from a WS event payload.
 * Handles both event.data.id (number) and event.id (string).
 */
function _extractId(event: WSEvent): string | null {
  const raw = (event.data as { id?: number | string })?.id ?? event.id
  return raw != null ? String(raw) : null
}

/**
 * Map a WS event payload → Round, converting all numeric IDs to strings.
 * Uses the provided status as the canonical current status.
 */
export function _extractRound(event: WSEvent, status: RoundStatus): Round | null {
  const data = event.data as Record<string, unknown> | undefined
  if (!data?.id) return null

  const id = String(data.id)
  const now = new Date().toISOString()

  return {
    id,
    round_number: Number(data.round_number ?? 0),
    session_id: String(data.session_id ?? ''),
    branch_id: String(data.branch_id ?? event.branch_id ?? ''),
    status,
    table_id: String(data.table_id ?? ''),
    table_code: String(data.table_code ?? ''),
    table_number: Number(data.table_number ?? 0),
    sector_id: data.sector_id != null ? String(data.sector_id) : null,
    sector_name: data.sector_name != null ? String(data.sector_name) : null,
    diner_id: data.diner_id != null ? String(data.diner_id) : null,
    diner_name: data.diner_name != null ? String(data.diner_name) : null,
    items_count: Number(data.items_count ?? 0),
    total_cents: Number(data.total_cents ?? 0),
    pending_at: String(data.pending_at ?? now),
    confirmed_at: data.confirmed_at != null ? String(data.confirmed_at) : null,
    submitted_at: data.submitted_at != null ? String(data.submitted_at) : null,
    in_kitchen_at: data.in_kitchen_at != null ? String(data.in_kitchen_at) : null,
    ready_at: data.ready_at != null ? String(data.ready_at) : null,
    served_at: data.served_at != null ? String(data.served_at) : null,
    canceled_at: data.canceled_at != null ? String(data.canceled_at) : null,
    cancel_reason: data.cancel_reason != null ? String(data.cancel_reason) : null,
    created_by_role: String(data.created_by_role ?? ''),
    created_at: String(data.created_at ?? now),
    updated_at: String(data.updated_at ?? now),
  }
}

/**
 * Evaluate whether a round matches the currently active filters.
 * Used by every WS handler before inserting / keeping a round in the list.
 */
export function _passesFilter(round: Round, filters: Partial<RoundFilters>): boolean {
  // branch_id must always match
  if (filters.branch_id && round.branch_id !== filters.branch_id) return false

  // date: compare pending_at date portion to filter.date
  if (filters.date) {
    const roundDate = round.pending_at.slice(0, 10)
    if (roundDate !== filters.date) return false
  }

  // sector_id
  if (filters.sector_id && round.sector_id !== filters.sector_id) return false

  // status
  if (filters.status && round.status !== filters.status) return false

  // table_code — case-insensitive partial
  if (filters.table_code) {
    const code = round.table_code.toLowerCase()
    if (!code.includes(filters.table_code.toLowerCase())) return false
  }

  return true
}

/**
 * Generic WS handler for all status transitions except PENDING and CANCELED.
 *
 * Logic (design.md D5):
 *   1. Extract round from event
 *   2. If round in store AND passes filter → UPDATE in place
 *   3. If round in store AND does NOT pass filter → REMOVE (transitioned out)
 *   4. If NOT in store AND passes filter → ADD
 *   5. If NOT in store AND does NOT pass → IGNORE
 */
function _handleTransition(
  event: WSEvent,
  status: RoundStatus,
  set: (fn: (s: RoundsAdminState) => Partial<RoundsAdminState>) => void,
  get: () => RoundsAdminState,
): void {
  const partial = _extractRound(event, status)
  const id = partial?.id ?? _extractId(event)
  if (!id) return

  const { filters, rounds } = get()
  const existing = rounds.find((r) => r.id === id)

  if (existing) {
    // Merge: preserve denorm fields from existing if WS payload is incomplete.
    // _extractRound uses '' or null as fallbacks for missing fields, so we strip
    // those sentinel values before merging — the existing denorm fields
    // (table_code, sector_name, etc.) are preserved when the WS event omits them.
    const partialClean = partial
      ? (Object.fromEntries(
          Object.entries(partial).filter(([, v]) => v !== '' && v !== null),
        ) as Partial<Round>)
      : {}
    const merged: Round = {
      ...existing,
      ...partialClean,
      status,
    }
    if (!_passesFilter(merged, filters)) {
      // Transitioned out of the active filter → remove
      set((s) => ({
        rounds: s.rounds.filter((r) => r.id !== id),
      }))
    } else {
      set((s) => ({
        rounds: s.rounds.map((r) => (r.id === id ? merged : r)),
      }))
    }
  } else if (partial && _passesFilter(partial, filters)) {
    // New round that falls into the active filter
    set((s) => ({ rounds: [...s.rounds, partial] }))
  }
  // else: not in store and doesn't pass → ignore
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectAdminRounds = (s: RoundsAdminState) =>
  s.rounds.length === 0 ? EMPTY_ROUNDS : s.rounds

export const selectRoundsLoading = (s: RoundsAdminState) => s.isLoading
export const selectRoundsError = (s: RoundsAdminState) => s.error
export const selectRoundsFilters = (s: RoundsAdminState) => s.filters
export const selectRoundsTotal = (s: RoundsAdminState) => s.total
export const selectSelectedRoundId = (s: RoundsAdminState) => s.selectedRoundId

export const selectSelectedRound = (s: RoundsAdminState): Round | null => {
  if (!s.selectedRoundId) return null
  return s.rounds.find((r) => r.id === s.selectedRoundId) ?? null
}

export const useRoundsAdminActions = () =>
  useRoundsAdminStore(
    useShallow((s) => ({
      fetchRounds: s.fetchRounds,
      setFilter: s.setFilter,
      clearFilters: s.clearFilters,
      selectRound: s.selectRound,
      cancelRound: s.cancelRound,
      reset: s.reset,
      handleRoundPending: s.handleRoundPending,
      handleRoundConfirmed: s.handleRoundConfirmed,
      handleRoundSubmitted: s.handleRoundSubmitted,
      handleRoundInKitchen: s.handleRoundInKitchen,
      handleRoundReady: s.handleRoundReady,
      handleRoundServed: s.handleRoundServed,
      handleRoundCanceled: s.handleRoundCanceled,
    })),
  )
