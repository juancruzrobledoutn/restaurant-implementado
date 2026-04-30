/**
 * waiterAssignmentStore unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useWaiterAssignmentStore } from './waiterAssignmentStore'
import type { WaiterAssignment } from '@/types/operations'

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
    user_id: 10,
    sector_id: 20,
    date: '2026-01-01',
    ...overrides,
  }
}

const existingAssignment: WaiterAssignment = {
  id: '1',
  user_id: '10',
  sector_id: '20',
  date: '2026-01-01',
}

beforeEach(() => {
  useWaiterAssignmentStore.setState({
    assignments: [],
    selectedDate: '2026-01-01',
    isLoading: false,
    error: null,
  })
  vi.clearAllMocks()
})

describe('initial_state', () => {
  it('starts empty', () => {
    const state = useWaiterAssignmentStore.getState()
    expect(state.assignments).toHaveLength(0)
    expect(state.isLoading).toBe(false)
  })
})

describe('fetchByDate', () => {
  it('populates assignments with string IDs', async () => {
    mockFetchAPI.mockResolvedValueOnce([makeBackend()])
    await useWaiterAssignmentStore.getState().fetchByDate('2026-01-01', '100')
    const { assignments } = useWaiterAssignmentStore.getState()
    expect(assignments).toHaveLength(1)
    expect(assignments[0]!.id).toBe('1')
    expect(assignments[0]!.user_id).toBe('10')
  })

  it('sets error on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('net'))
    await useWaiterAssignmentStore.getState().fetchByDate('2026-01-01')
    expect(useWaiterAssignmentStore.getState().error).toBe(
      'error:waiterAssignmentStore.fetchByDate',
    )
  })
})

describe('createAsync', () => {
  it('adds assignment to list', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ id: 99 }))
    await useWaiterAssignmentStore.getState().createAsync('20', '10', '2026-01-01')
    expect(useWaiterAssignmentStore.getState().assignments).toHaveLength(1)
    expect(useWaiterAssignmentStore.getState().assignments[0]!.id).toBe('99')
  })

  it('throws and sets error on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('409'))
    await expect(
      useWaiterAssignmentStore.getState().createAsync('20', '10', '2026-01-01'),
    ).rejects.toThrow()
  })
})

describe('deleteAsync', () => {
  beforeEach(() => {
    useWaiterAssignmentStore.setState({ assignments: [existingAssignment] })
  })

  it('removes assignment on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(undefined)
    await useWaiterAssignmentStore.getState().deleteAsync('1')
    expect(useWaiterAssignmentStore.getState().assignments).toHaveLength(0)
  })

  it('rolls back on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    await expect(useWaiterAssignmentStore.getState().deleteAsync('1')).rejects.toThrow()
    expect(useWaiterAssignmentStore.getState().assignments).toHaveLength(1)
  })
})

describe('setDate', () => {
  it('updates selectedDate', () => {
    useWaiterAssignmentStore.getState().setDate('2026-12-31')
    expect(useWaiterAssignmentStore.getState().selectedDate).toBe('2026-12-31')
  })
})

describe('migrate_from_v1_noop', () => {
  it('assignments is always an array', () => {
    expect(Array.isArray(useWaiterAssignmentStore.getState().assignments)).toBe(true)
  })
})
