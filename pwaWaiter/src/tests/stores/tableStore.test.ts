/**
 * tableStore tests — shape, mutations, and stable references for selectors.
 * Updated in C-21: Table now includes sessionId and sessionStatus fields.
 * New in C-21: loadTables fetch, byId indexing, WS event handlers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import {
  useTableStore,
  selectTables,
  selectSectorName,
  selectTablesFetchStatus,
  selectTableById,
  useTablesByStatus,
  useTablesBySector,
} from '@/stores/tableStore'
import type { Table } from '@/stores/tableStore'

const API = 'http://localhost:8000'

const SAMPLE: Table[] = [
  { id: '1', code: 'INT-01', status: 'AVAILABLE', sectorId: '5', sectorName: 'Salón', sessionId: null, sessionStatus: null },
  { id: '2', code: 'INT-02', status: 'OCCUPIED', sectorId: '5', sectorName: 'Salón', sessionId: null, sessionStatus: null },
  { id: '3', code: 'INT-03', status: 'AVAILABLE', sectorId: '5', sectorName: 'Salón', sessionId: null, sessionStatus: null },
]

describe('tableStore', () => {
  beforeEach(() => {
    useTableStore.getState().clearTables()
  })

  it('setTables replaces the tables array', () => {
    useTableStore.getState().setTables(SAMPLE, 'Salón')
    expect(selectTables(useTableStore.getState())).toEqual(SAMPLE)
    expect(selectSectorName(useTableStore.getState())).toBe('Salón')
  })

  it('updateTableStatus mutates only the matching table', () => {
    useTableStore.getState().setTables(SAMPLE)
    useTableStore.getState().updateTableStatus('2', 'PAYING')

    const tables = selectTables(useTableStore.getState())
    expect(tables[0]?.status).toBe('AVAILABLE')
    expect(tables[1]?.status).toBe('PAYING')
    expect(tables[2]?.status).toBe('AVAILABLE')
  })

  it('updateTableStatus is a no-op for unknown IDs', () => {
    useTableStore.getState().setTables(SAMPLE)
    const before = selectTables(useTableStore.getState())
    useTableStore.getState().updateTableStatus('999', 'PAYING')
    const after = selectTables(useTableStore.getState())
    // Same reference = store didn't mutate
    expect(after).toBe(before)
  })

  it('clearTables empties the array and sectorName', () => {
    useTableStore.getState().setTables(SAMPLE, 'Salón')
    useTableStore.getState().clearTables()
    expect(selectTables(useTableStore.getState())).toEqual([])
    expect(selectSectorName(useTableStore.getState())).toBeNull()
  })

  it('useTablesByStatus returns a stable reference across renders via useShallow', () => {
    useTableStore.getState().setTables(SAMPLE)

    const { result, rerender } = renderHook(() => useTablesByStatus('AVAILABLE'))
    const first = result.current
    expect(first).toHaveLength(2)

    // Trigger a render that does NOT change the filtered result
    rerender()
    expect(result.current).toBe(first)

    // Update an AVAILABLE table's status to OCCUPIED → filtered array changes
    useTableStore.getState().updateTableStatus('1', 'OCCUPIED')

    // Wait for reactive update
    vi.waitFor(() => {
      expect(result.current).toHaveLength(1)
    })
  })
})

// ---------------------------------------------------------------------------
// C-21: loadTables, byId indexing, WS handlers, useTablesBySector
// ---------------------------------------------------------------------------

const API_TABLES = [
  { id: 1, code: 'INT-01', status: 'AVAILABLE', sector_id: 5, sector_name: 'Salón', session_id: null, session_status: null },
  { id: 2, code: 'INT-02', status: 'OCCUPIED', sector_id: 5, sector_name: 'Salón', session_id: 10, session_status: 'OPEN' },
  { id: 3, code: 'EXT-01', status: 'AVAILABLE', sector_id: 6, sector_name: 'Terraza', session_id: null, session_status: null },
]

describe('tableStore — C-21 extensions', () => {
  beforeEach(() => {
    useTableStore.getState().clearTables()
  })

  describe('loadTables', () => {
    it('fetches tables and populates byId + bySector + tables + status=ready', async () => {
      server.use(
        http.get(`${API}/api/waiter/tables`, () => HttpResponse.json(API_TABLES)),
      )

      await useTableStore.getState().loadTables()

      expect(selectTablesFetchStatus(useTableStore.getState())).toBe('ready')
      expect(selectTables(useTableStore.getState())).toHaveLength(3)
    })

    it('builds byId index with string IDs', async () => {
      server.use(
        http.get(`${API}/api/waiter/tables`, () => HttpResponse.json(API_TABLES)),
      )

      await useTableStore.getState().loadTables()

      const table = selectTableById('1')(useTableStore.getState())
      expect(table).toBeDefined()
      expect(table?.code).toBe('INT-01')
      expect(table?.sessionId).toBeNull()
    })

    it('builds bySector index grouping tables by sectorId', async () => {
      server.use(
        http.get(`${API}/api/waiter/tables`, () => HttpResponse.json(API_TABLES)),
      )

      await useTableStore.getState().loadTables()

      const { result } = renderHook(() => useTablesBySector('5'))
      expect(result.current).toHaveLength(2) // INT-01 + INT-02
    })

    it('sets status=error on fetch failure', async () => {
      server.use(
        http.get(`${API}/api/waiter/tables`, () =>
          HttpResponse.json({ detail: 'Server error' }, { status: 500 }),
        ),
      )

      await useTableStore.getState().loadTables()
      expect(selectTablesFetchStatus(useTableStore.getState())).toBe('error')
    })

    it('preserves sessionId and sessionStatus from API', async () => {
      server.use(
        http.get(`${API}/api/waiter/tables`, () => HttpResponse.json(API_TABLES)),
      )

      await useTableStore.getState().loadTables()

      const table = selectTableById('2')(useTableStore.getState())
      expect(table?.sessionId).toBe('10')
      expect(table?.sessionStatus).toBe('OPEN')
    })
  })

  describe('WS event handlers', () => {
    beforeEach(() => {
      // Seed the store with tables directly via setTables
      const tables: Table[] = [
        { id: '1', code: 'INT-01', status: 'AVAILABLE', sectorId: '5', sectorName: 'Salón', sessionId: null, sessionStatus: null },
        { id: '2', code: 'INT-02', status: 'OCCUPIED', sectorId: '5', sectorName: 'Salón', sessionId: '10', sessionStatus: 'OPEN' },
      ]
      useTableStore.getState().setTables(tables)
    })

    it('applySessionStarted sets status=ACTIVE and sessionId', () => {
      useTableStore.getState().applySessionStarted('1', 'sess-99')

      const table = selectTableById('1')(useTableStore.getState())
      expect(table?.status).toBe('ACTIVE')
      expect(table?.sessionId).toBe('sess-99')
      expect(table?.sessionStatus).toBe('OPEN')
    })

    it('applySessionStarted is a no-op for unknown tableId', () => {
      const before = useTableStore.getState().byId
      useTableStore.getState().applySessionStarted('999', 'sess-99')
      expect(useTableStore.getState().byId).toBe(before)
    })

    it('applySessionCleared sets status=AVAILABLE and clears sessionId', () => {
      useTableStore.getState().applySessionCleared('2')

      const table = selectTableById('2')(useTableStore.getState())
      expect(table?.status).toBe('AVAILABLE')
      expect(table?.sessionId).toBeNull()
      expect(table?.sessionStatus).toBeNull()
    })

    it('applyStatusChanged updates only the status field', () => {
      useTableStore.getState().applyStatusChanged('1', 'PAYING')

      const table = selectTableById('1')(useTableStore.getState())
      expect(table?.status).toBe('PAYING')
      // Other fields unchanged
      expect(table?.code).toBe('INT-01')
    })

    it('applyCheckRequested sets status=PAYING and sessionStatus=PAYING', () => {
      useTableStore.getState().applyCheckRequested('2')

      const table = selectTableById('2')(useTableStore.getState())
      expect(table?.status).toBe('PAYING')
      expect(table?.sessionStatus).toBe('PAYING')
    })

    it('applyCheckPaid sets sessionStatus=PAID without changing table status', () => {
      useTableStore.getState().applyCheckRequested('2') // sets PAYING
      useTableStore.getState().applyCheckPaid('2')

      const table = selectTableById('2')(useTableStore.getState())
      expect(table?.sessionStatus).toBe('PAID')
    })
  })

  describe('useTablesBySector', () => {
    it('returns stable reference when sector tables do not change', () => {
      const tables: Table[] = [
        { id: '1', code: 'INT-01', status: 'AVAILABLE', sectorId: '5', sectorName: 'Salón', sessionId: null, sessionStatus: null },
      ]
      useTableStore.getState().setTables(tables)

      const { result, rerender } = renderHook(() => useTablesBySector('5'))
      const first = result.current
      expect(first).toHaveLength(1)

      rerender()
      expect(result.current).toBe(first) // stable reference
    })

    it('returns EMPTY_TABLES for unknown sectorId', () => {
      useTableStore.getState().setTables(SAMPLE)
      const { result } = renderHook(() => useTablesBySector('999'))
      expect(result.current).toHaveLength(0)
    })
  })
})
