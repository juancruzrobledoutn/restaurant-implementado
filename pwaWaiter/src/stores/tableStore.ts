/**
 * tableStore — tables for the waiter's assigned sector.
 *
 * Extended in C-21 from the C-20 shell:
 * - Real fetch via fetchWaiterTables()
 * - byId + bySector indexing for O(1) lookups
 * - WS event handlers: applySessionStarted, applySessionCleared,
 *   applyStatusChanged, applyCheckRequested, applyCheckPaid
 *
 * Rules enforced (zustand-store-pattern skill):
 * - NEVER destructure — use named selectors
 * - useShallow for filtered/mapped arrays
 * - EMPTY_ARRAY stable ref, no inline `?? []`
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { fetchWaiterTables } from '@/services/waiter'
import { logger } from '@/utils/logger'
import { EMPTY_ARRAY } from '@/lib/constants'
import type { WaiterTableDTO } from '@/services/waiter'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'ACTIVE' | 'PAYING' | 'OUT_OF_SERVICE'

export interface Table {
  id: string
  code: string
  status: TableStatus
  sectorId: string
  sectorName: string
  sessionId: string | null
  sessionStatus: string | null
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type FetchStatus = 'idle' | 'loading' | 'ready' | 'error'

interface TableState {
  byId: Record<string, Table>
  bySector: Record<string, string[]>
  status: FetchStatus
  lastFetch: number | null

  // Actions
  loadTables: () => Promise<void>
  applySessionStarted: (tableId: string, sessionId: string) => void
  applySessionCleared: (tableId: string) => void
  applyStatusChanged: (tableId: string, status: TableStatus) => void
  applyCheckRequested: (tableId: string) => void
  applyCheckPaid: (tableId: string) => void
  clearTables: () => void

  // Legacy compat (C-20 tests)
  tables: Table[]
  sectorName: string | null
  setTables: (tables: Table[], sectorName?: string | null) => void
  updateTableStatus: (tableId: string, status: TableStatus) => void
}

// Stable empty fallbacks
const EMPTY_TABLES: Table[] = EMPTY_ARRAY as unknown as Table[]

function normalizeDTO(dto: WaiterTableDTO): Table {
  return {
    id: dto.id,
    code: dto.code,
    status: dto.status as TableStatus,
    sectorId: dto.sectorId,
    sectorName: dto.sectorName,
    sessionId: dto.sessionId ?? null,
    sessionStatus: dto.sessionStatus ?? null,
  }
}

function buildIndexes(tables: Table[]): {
  byId: Record<string, Table>
  bySector: Record<string, string[]>
} {
  const byId: Record<string, Table> = {}
  const bySector: Record<string, string[]> = {}

  for (const table of tables) {
    byId[table.id] = table
    if (!bySector[table.sectorId]) {
      bySector[table.sectorId] = []
    }
    bySector[table.sectorId]!.push(table.id)
  }

  return { byId, bySector }
}

export const useTableStore = create<TableState>()((set, _get) => ({
  byId: {},
  bySector: {},
  status: 'idle',
  lastFetch: null,

  // Legacy shape compatibility for C-20 tests
  tables: EMPTY_TABLES,
  sectorName: null,

  // ------------------------------------------------------------------
  // loadTables — fetch + hydrate
  // ------------------------------------------------------------------
  loadTables: async () => {
    set({ status: 'loading' })
    try {
      const dtos = await fetchWaiterTables()
      const tables = dtos.map(normalizeDTO)
      const { byId, bySector } = buildIndexes(tables)

      // Derive sectorName from first table (legacy compat)
      const firstTable = tables[0]
      const sectorName = firstTable?.sectorName ?? null

      set({
        byId,
        bySector,
        tables,
        sectorName,
        status: 'ready',
        lastFetch: Date.now(),
      })
      logger.info(`tableStore: loaded ${tables.length} tables`)
    } catch (err) {
      logger.error('tableStore: loadTables failed', err)
      set({ status: 'error' })
    }
  },

  // ------------------------------------------------------------------
  // WS event handlers
  // ------------------------------------------------------------------

  applySessionStarted: (tableId, sessionId) =>
    set((state) => {
      if (!(tableId in state.byId)) return state
      const updated: Table = {
        ...state.byId[tableId]!,
        sessionId,
        status: 'ACTIVE',
        sessionStatus: 'OPEN',
      }
      const tables = state.tables.map((t) => (t.id === tableId ? updated : t))
      return { byId: { ...state.byId, [tableId]: updated }, tables }
    }),

  applySessionCleared: (tableId) =>
    set((state) => {
      if (!(tableId in state.byId)) return state
      const updated: Table = {
        ...state.byId[tableId]!,
        sessionId: null,
        status: 'AVAILABLE',
        sessionStatus: null,
      }
      const tables = state.tables.map((t) => (t.id === tableId ? updated : t))
      return { byId: { ...state.byId, [tableId]: updated }, tables }
    }),

  applyStatusChanged: (tableId, status) =>
    set((state) => {
      if (!(tableId in state.byId)) return state
      const updated: Table = { ...state.byId[tableId]!, status }
      const tables = state.tables.map((t) => (t.id === tableId ? updated : t))
      return { byId: { ...state.byId, [tableId]: updated }, tables }
    }),

  applyCheckRequested: (tableId) =>
    set((state) => {
      if (!(tableId in state.byId)) return state
      const updated: Table = {
        ...state.byId[tableId]!,
        status: 'PAYING',
        sessionStatus: 'PAYING',
      }
      const tables = state.tables.map((t) => (t.id === tableId ? updated : t))
      return { byId: { ...state.byId, [tableId]: updated }, tables }
    }),

  applyCheckPaid: (tableId) =>
    set((state) => {
      if (!(tableId in state.byId)) return state
      const updated: Table = {
        ...state.byId[tableId]!,
        sessionStatus: 'PAID',
      }
      const tables = state.tables.map((t) => (t.id === tableId ? updated : t))
      return { byId: { ...state.byId, [tableId]: updated }, tables }
    }),

  clearTables: () =>
    set({
      byId: {},
      bySector: {},
      tables: EMPTY_TABLES,
      sectorName: null,
      status: 'idle',
      lastFetch: null,
    }),

  // ------------------------------------------------------------------
  // Legacy actions (C-20 compat)
  // ------------------------------------------------------------------

  setTables: (tables, sectorName) => {
    const { byId, bySector } = buildIndexes(tables)
    set((state) => ({
      byId,
      bySector,
      tables,
      sectorName: sectorName === undefined ? state.sectorName : sectorName,
      status: 'ready',
    }))
  },

  updateTableStatus: (tableId, status) =>
    set((state) => {
      const idx = state.tables.findIndex((t) => t.id === tableId)
      if (idx === -1) return state
      const next = state.tables.slice()
      const current = next[idx]!
      const updated = { ...current, status }
      next[idx] = updated
      return {
        tables: next,
        byId: { ...state.byId, [tableId]: updated },
      }
    }),
}))

// ---------------------------------------------------------------------------
// Selectors — NEVER destructure
// ---------------------------------------------------------------------------

export const selectTables = (s: TableState): Table[] => s.tables
export const selectSectorName = (s: TableState): string | null => s.sectorName
export const selectTablesFetchStatus = (s: TableState): FetchStatus => s.status
export const selectSetTables = (s: TableState) => s.setTables
export const selectUpdateTableStatus = (s: TableState) => s.updateTableStatus
export const selectClearTables = (s: TableState) => s.clearTables
export const selectLoadTables = (s: TableState) => s.loadTables
export const selectTableCount = (s: TableState): number => s.tables.length

/** Find a table by ID — plain selector (returns single item or undefined). */
export const selectTableById =
  (tableId: string) =>
  (s: TableState): Table | undefined =>
    s.byId[tableId]

/** Tables for a sector — useShallow hook. */
export function useTablesBySector(sectorId: string): Table[] {
  return useTableStore(
    useShallow((s) => {
      const ids = s.bySector[sectorId]
      if (!ids) return EMPTY_TABLES
      return ids.map((id) => s.byId[id]).filter((t): t is Table => t !== undefined)
    }),
  )
}

/** Filtered by status — still used in tests from C-20. */
export function useTablesByStatus(status: TableStatus): Table[] {
  return useTableStore(
    useShallow((s) => s.tables.filter((t) => t.status === status)),
  )
}
