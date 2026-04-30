/**
 * serviceCallsStore — real-time service call inbox for the waiter.
 *
 * Indexed by `id` (string). Updated by:
 * - Initial fetch: `listServiceCalls()` → `hydrate(list)`
 * - WS events: SERVICE_CALL_CREATED → `upsert`, SERVICE_CALL_ACKED → `upsert`,
 *               SERVICE_CALL_CLOSED → `remove`
 *
 * Rules (zustand-store-pattern skill):
 * - NEVER destructure — use named selectors
 * - useShallow for filtered array selectors
 * - EMPTY_ARRAY stable fallback
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { EMPTY_ARRAY } from '@/lib/constants'
import type { ServiceCallDTO } from '@/services/waiter'

// Re-export for consumers
export type { ServiceCallDTO as ServiceCall }

// Stable empty fallback
const EMPTY_CALLS: ServiceCallDTO[] = EMPTY_ARRAY as unknown as ServiceCallDTO[]

interface ServiceCallsState {
  byId: Record<string, ServiceCallDTO>

  // Actions
  hydrate: (list: ServiceCallDTO[]) => void
  upsert: (call: ServiceCallDTO) => void
  remove: (id: string) => void
}

export const useServiceCallsStore = create<ServiceCallsState>()((set) => ({
  byId: {},

  // ------------------------------------------------------------------
  // hydrate — replace all entries (initial fetch)
  // ------------------------------------------------------------------
  hydrate: (list) => {
    const byId: Record<string, ServiceCallDTO> = {}
    for (const call of list) {
      byId[call.id] = call
    }
    set({ byId })
  },

  // ------------------------------------------------------------------
  // upsert — insert or update (idempotent by id)
  // ------------------------------------------------------------------
  upsert: (call) =>
    set((state) => ({
      byId: { ...state.byId, [call.id]: call },
    })),

  // ------------------------------------------------------------------
  // remove — delete a closed call
  // ------------------------------------------------------------------
  remove: (id) =>
    set((state) => {
      const next = { ...state.byId }
      delete next[id]
      return { byId: next }
    }),
}))

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** All active (non-CLOSED) service calls — useShallow. */
export function useActiveCalls(): ServiceCallDTO[] {
  return useServiceCallsStore(
    useShallow((s) =>
      Object.values(s.byId).filter((c) => c.status !== 'CLOSED'),
    ),
  )
}

/** Service calls for a specific table — useShallow. */
export function useCallsByTable(tableId: string): ServiceCallDTO[] {
  return useServiceCallsStore(
    useShallow((s) =>
      Object.values(s.byId).filter((c) => c.tableId === tableId && c.status !== 'CLOSED'),
    ),
  )
}

/** Service calls for a specific sector — useShallow. */
export function useCallsBySector(sectorId: string): ServiceCallDTO[] {
  return useServiceCallsStore(
    useShallow((s) =>
      Object.values(s.byId).filter((c) => c.sectorId === sectorId && c.status !== 'CLOSED'),
    ),
  )
}

/** Non-reactive: count of open calls for a table (for deriveVisualState). */
export const selectOpenCallCountByTable = (tableId: string) =>
  (s: ServiceCallsState): number =>
    Object.values(s.byId).filter(
      (c) => c.tableId === tableId && c.status !== 'CLOSED',
    ).length

/** Non-reactive: all calls for deriving visual state. */
export const selectAllCalls = (s: ServiceCallsState): ServiceCallDTO[] =>
  Object.values(s.byId) ?? EMPTY_CALLS
