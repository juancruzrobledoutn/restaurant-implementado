/**
 * tableStore unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTableStore } from './tableStore'
import type { Table } from '@/types/operations'
import type { WSEvent } from '@/types/menu'

vi.mock('@/services/api', () => ({ fetchAPI: vi.fn() }))
vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))
vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { fetchAPI } from '@/services/api'
const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

function makeBackend(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    branch_id: 100,
    sector_id: 10,
    number: 1,
    code: 'A-01',
    capacity: 4,
    status: 'AVAILABLE',
    is_active: true,
    ...overrides,
  }
}

const baseFormData = {
  number: 1,
  code: 'A-01',
  sector_id: '10',
  capacity: 4,
  status: 'AVAILABLE' as const,
  branch_id: '100',
  is_active: true,
}

const existingTable: Table = {
  id: '1',
  branch_id: '100',
  sector_id: '10',
  number: 1,
  code: 'A-01',
  capacity: 4,
  status: 'AVAILABLE',
  is_active: true,
}

beforeEach(() => {
  useTableStore.setState({ items: [], isLoading: false, error: null })
  vi.clearAllMocks()
})

describe('fetchByBranch', () => {
  it('stores tables with string IDs', async () => {
    mockFetchAPI.mockResolvedValueOnce([makeBackend(), makeBackend({ id: 2, number: 2 })])
    await useTableStore.getState().fetchByBranch('100')
    const { items } = useTableStore.getState()
    expect(items).toHaveLength(2)
    expect(items[0]!.id).toBe('1')
    expect(items[0]!.sector_id).toBe('10')
  })
})

describe('createTableAsync', () => {
  it('adds table to list', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ id: 99 }))
    await useTableStore.getState().createTableAsync(baseFormData)
    expect(useTableStore.getState().items).toHaveLength(1)
    expect(useTableStore.getState().items[0]!.id).toBe('99')
  })
})

describe('updateTableAsync', () => {
  beforeEach(() => { useTableStore.setState({ items: [existingTable] }) })

  it('replaces item on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ number: 5 }))
    await useTableStore.getState().updateTableAsync('1', { ...baseFormData, number: 5 })
    expect(useTableStore.getState().items[0]!.number).toBe(5)
  })

  it('rolls back on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    await expect(useTableStore.getState().updateTableAsync('1', baseFormData)).rejects.toThrow()
    expect(useTableStore.getState().items[0]!.number).toBe(1)
  })
})

describe('deleteTableAsync', () => {
  beforeEach(() => { useTableStore.setState({ items: [existingTable] }) })

  it('removes table on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(undefined)
    await useTableStore.getState().deleteTableAsync('1')
    expect(useTableStore.getState().items).toHaveLength(0)
  })

  it('rolls back on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    await expect(useTableStore.getState().deleteTableAsync('1')).rejects.toThrow()
    expect(useTableStore.getState().items).toHaveLength(1)
  })
})

describe('clearAll', () => {
  it('resets items, isLoading, and error', () => {
    useTableStore.setState({ items: [existingTable], isLoading: true, error: 'some error' })
    useTableStore.getState().clearAll()
    const { items, isLoading, error } = useTableStore.getState()
    expect(items).toHaveLength(0)
    expect(isLoading).toBe(false)
    expect(error).toBeNull()
  })
})

describe('handleTableStatusChanged', () => {
  beforeEach(() => { useTableStore.setState({ items: [existingTable] }) })

  it('patches status field only', () => {
    const event = {
      type: 'TABLE_STATUS_CHANGED',
      data: { id: 1, status: 'OCCUPIED' },
    } as unknown as WSEvent

    useTableStore.getState().handleTableStatusChanged(event)
    const { items } = useTableStore.getState()
    expect(items[0]!.status).toBe('OCCUPIED')
    expect(items[0]!.code).toBe('A-01') // other fields unchanged
  })

  it('does nothing if id not found', () => {
    const event = {
      type: 'TABLE_STATUS_CHANGED',
      data: { id: 999, status: 'OCCUPIED' },
    } as unknown as WSEvent

    useTableStore.getState().handleTableStatusChanged(event)
    expect(useTableStore.getState().items[0]!.status).toBe('AVAILABLE')
  })
})

// ---------------------------------------------------------------------------
// Selectors: selectActiveTablesCount + selectTotalTablesCount (C-30)
// ---------------------------------------------------------------------------

import { selectActiveTablesCount, selectTotalTablesCount } from './tableStore'

function makeTable(overrides: Partial<Table> = {}): Table {
  return {
    id: '1',
    branch_id: '100',
    sector_id: '10',
    number: 1,
    code: 'A-01',
    capacity: 4,
    status: 'AVAILABLE',
    is_active: true,
    ...overrides,
  }
}

describe('selectActiveTablesCount', () => {
  it('returns 0 when no tables', () => {
    useTableStore.setState({ items: [] })
    const count = selectActiveTablesCount(useTableStore.getState())
    expect(count).toBe(0)
  })

  it('counts only OCCUPIED and is_active tables', () => {
    useTableStore.setState({
      items: [
        makeTable({ id: '1', status: 'OCCUPIED', is_active: true }),
        makeTable({ id: '2', status: 'AVAILABLE', is_active: true }),
        makeTable({ id: '3', status: 'OCCUPIED', is_active: false }), // inactive — excluded
        makeTable({ id: '4', status: 'OCCUPIED', is_active: true }),
      ],
    })
    const count = selectActiveTablesCount(useTableStore.getState())
    expect(count).toBe(2)
  })

  it('returns 0 when all tables are AVAILABLE', () => {
    useTableStore.setState({
      items: [
        makeTable({ id: '1', status: 'AVAILABLE', is_active: true }),
        makeTable({ id: '2', status: 'AVAILABLE', is_active: true }),
      ],
    })
    expect(selectActiveTablesCount(useTableStore.getState())).toBe(0)
  })
})

describe('selectTotalTablesCount', () => {
  it('returns 0 when no tables', () => {
    useTableStore.setState({ items: [] })
    expect(selectTotalTablesCount(useTableStore.getState())).toBe(0)
  })

  it('counts only is_active tables regardless of status', () => {
    useTableStore.setState({
      items: [
        makeTable({ id: '1', status: 'AVAILABLE', is_active: true }),
        makeTable({ id: '2', status: 'OCCUPIED', is_active: true }),
        makeTable({ id: '3', status: 'OCCUPIED', is_active: false }), // inactive — excluded
      ],
    })
    expect(selectTotalTablesCount(useTableStore.getState())).toBe(2)
  })
})
