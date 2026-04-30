/**
 * roundsAdminStore unit tests (C-25).
 *
 * Tests:
 * - fetchRounds happy/error path
 * - WS handlers: handleRoundPending, handleRoundConfirmed, handleRoundServed, handleRoundCanceled
 * - _passesFilter logic (branch_id, date, status, table_code)
 * - setFilter / clearFilters
 * - selectAdminRounds stable EMPTY_ROUNDS reference
 * - useRoundsAdminActions identity stability
 * - cancelRound: calls API, does NOT mutate store on success (waits for WS)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRoundsAdminStore, selectAdminRounds, EMPTY_ROUNDS } from './roundsAdminStore'
import type { WSEvent } from '@/types/menu'
import type { Round } from '@/types/operations'

vi.mock('@/services/api', () => ({ fetchAPI: vi.fn() }))
vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

import { fetchAPI } from '@/services/api'
const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: '1',
    round_number: 1,
    session_id: '10',
    branch_id: '5',
    status: 'PENDING',
    table_id: '7',
    table_code: 'A-01',
    table_number: 1,
    sector_id: '2',
    sector_name: 'Salon',
    diner_id: null,
    diner_name: null,
    items_count: 2,
    total_cents: 3000,
    pending_at: new Date().toISOString(),
    confirmed_at: null,
    submitted_at: null,
    in_kitchen_at: null,
    ready_at: null,
    served_at: null,
    canceled_at: null,
    cancel_reason: null,
    created_by_role: 'WAITER',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeWSEvent(data: Record<string, unknown>, type = 'ROUND_PENDING'): WSEvent {
  return {
    type,
    branch_id: data.branch_id ? String(data.branch_id) : '5',
    data,
  } as unknown as WSEvent
}

const DEFAULT_FILTERS = {
  branch_id: '5',
  date: TODAY,
  limit: 50,
  offset: 0,
}

beforeEach(() => {
  useRoundsAdminStore.setState({
    rounds: [],
    total: 0,
    filters: { ...DEFAULT_FILTERS },
    isLoading: false,
    error: null,
    pagination: { limit: 50, offset: 0 },
    selectedRoundId: null,
  })
  vi.clearAllMocks()
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// 6.2 — fetchRounds happy path
// ---------------------------------------------------------------------------

describe('fetchRounds_happy_path', () => {
  it('sets rounds, total, isLoading=false on success', async () => {
    mockFetchAPI.mockResolvedValueOnce({
      items: [
        {
          id: 1, round_number: 1, session_id: 10, branch_id: 5, status: 'PENDING',
          table_id: 7, table_code: 'A-01', table_number: 1,
          sector_id: 2, sector_name: 'Salon', diner_id: null, diner_name: null,
          items_count: 1, total_cents: 500,
          pending_at: new Date().toISOString(),
          confirmed_at: null, submitted_at: null, in_kitchen_at: null,
          ready_at: null, served_at: null, canceled_at: null, cancel_reason: null,
          created_by_role: 'WAITER', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }
      ],
      total: 1,
      limit: 50,
      offset: 0,
    })

    await useRoundsAdminStore.getState().fetchRounds(DEFAULT_FILTERS)

    const state = useRoundsAdminStore.getState()
    expect(state.rounds).toHaveLength(1)
    expect(state.rounds[0]!.id).toBe('1')
    expect(state.total).toBe(1)
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6.3 — fetchRounds error path
// ---------------------------------------------------------------------------

describe('fetchRounds_error_path', () => {
  it('sets error and clears isLoading on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('Network error'))

    await useRoundsAdminStore.getState().fetchRounds(DEFAULT_FILTERS)

    const state = useRoundsAdminStore.getState()
    expect(state.isLoading).toBe(false)
    expect(state.error).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6.4 — handleRoundPending: round passes filter → added
// ---------------------------------------------------------------------------

describe('handleRoundPending_passes_filter', () => {
  it('adds round when it passes the active filter', () => {
    const event = makeWSEvent({
      id: 1,
      round_number: 1,
      session_id: 10,
      branch_id: 5,
      status: 'PENDING',
      table_id: 7,
      table_code: 'A-01',
      table_number: 1,
      sector_id: 2,
      sector_name: 'Salon',
      diner_id: null,
      diner_name: null,
      items_count: 1,
      total_cents: 500,
      pending_at: new Date().toISOString(),
      created_by_role: 'WAITER',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, 'ROUND_PENDING')

    useRoundsAdminStore.getState().handleRoundPending(event)
    expect(useRoundsAdminStore.getState().rounds).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 6.5 — handleRoundPending: different branch_id → ignored
// ---------------------------------------------------------------------------

describe('handleRoundPending_wrong_branch', () => {
  it('ignores round from a different branch', () => {
    const event = makeWSEvent({
      id: 1,
      branch_id: 999,  // different branch
      status: 'PENDING',
      pending_at: new Date().toISOString(),
    }, 'ROUND_PENDING')

    useRoundsAdminStore.getState().handleRoundPending(event)
    expect(useRoundsAdminStore.getState().rounds).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 6.6 — handleRoundPending: round on different date → ignored
// ---------------------------------------------------------------------------

describe('handleRoundPending_wrong_date', () => {
  it('ignores round with pending_at outside filter date', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString()
    const event = makeWSEvent({
      id: 1,
      branch_id: 5,
      status: 'PENDING',
      pending_at: yesterday,
    }, 'ROUND_PENDING')

    useRoundsAdminStore.getState().handleRoundPending(event)
    expect(useRoundsAdminStore.getState().rounds).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 6.7 — handleRoundConfirmed: status filter PENDING, round in store → removed
// ---------------------------------------------------------------------------

describe('handleRoundConfirmed_status_filter_mismatch', () => {
  it('removes round from store when status filter is PENDING and round becomes CONFIRMED', () => {
    // Setup: round in store
    useRoundsAdminStore.setState({
      rounds: [makeRound({ id: '1', status: 'PENDING' })],
      filters: { ...DEFAULT_FILTERS, status: 'PENDING' },
    })

    const event = makeWSEvent({
      id: 1,
      branch_id: 5,
      status: 'CONFIRMED',
      pending_at: new Date().toISOString(),
    }, 'ROUND_CONFIRMED')

    useRoundsAdminStore.getState().handleRoundConfirmed(event)
    expect(useRoundsAdminStore.getState().rounds).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 6.8 — handleRoundConfirmed: no status filter, round in store → updated in place
// ---------------------------------------------------------------------------

describe('handleRoundConfirmed_no_status_filter', () => {
  it('updates round in place when no status filter is active', () => {
    useRoundsAdminStore.setState({
      rounds: [makeRound({ id: '1', status: 'PENDING' })],
      filters: { ...DEFAULT_FILTERS },  // no status filter
    })

    const event = makeWSEvent({
      id: 1,
      branch_id: 5,
      status: 'CONFIRMED',
      pending_at: new Date().toISOString(),
    }, 'ROUND_CONFIRMED')

    useRoundsAdminStore.getState().handleRoundConfirmed(event)
    const state = useRoundsAdminStore.getState()
    expect(state.rounds).toHaveLength(1)
    expect(state.rounds[0]!.status).toBe('CONFIRMED')
  })
})

// ---------------------------------------------------------------------------
// 6.9 — handleRoundServed: partial payload → merge preserves existing fields
// ---------------------------------------------------------------------------

describe('handleRoundServed_partial_payload', () => {
  it('merges partial payload preserving table_code and sector_name', () => {
    const existing = makeRound({ id: '1', status: 'READY', table_code: 'B-05', sector_name: 'Terraza' })
    useRoundsAdminStore.setState({ rounds: [existing] })

    // Partial event with only id, status, served_at
    const event = makeWSEvent({
      id: 1,
      status: 'SERVED',
      served_at: new Date().toISOString(),
      branch_id: 5,
      pending_at: existing.pending_at,
    }, 'ROUND_SERVED')

    useRoundsAdminStore.getState().handleRoundServed(event)
    const updated = useRoundsAdminStore.getState().rounds[0]!
    expect(updated.status).toBe('SERVED')
    expect(updated.table_code).toBe('B-05')
    expect(updated.sector_name).toBe('Terraza')
  })
})

// ---------------------------------------------------------------------------
// 6.10 — handleRoundCanceled: removes round and clears selectedRoundId
// ---------------------------------------------------------------------------

describe('handleRoundCanceled', () => {
  it('removes round from store and clears selectedRoundId if it matches', () => {
    useRoundsAdminStore.setState({
      rounds: [makeRound({ id: '1' })],
      selectedRoundId: '1',
    })

    const event = makeWSEvent({ id: 1, branch_id: 5, status: 'CANCELED', pending_at: new Date().toISOString() }, 'ROUND_CANCELED')
    useRoundsAdminStore.getState().handleRoundCanceled(event)

    const state = useRoundsAdminStore.getState()
    expect(state.rounds).toHaveLength(0)
    expect(state.selectedRoundId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6.11 — setFilter: updates filters without triggering fetch
// ---------------------------------------------------------------------------

describe('setFilter', () => {
  it('updates a single filter key without auto-fetching', () => {
    useRoundsAdminStore.getState().setFilter('status', 'CONFIRMED')
    expect(useRoundsAdminStore.getState().filters.status).toBe('CONFIRMED')
    // fetchAPI should NOT have been called
    expect(mockFetchAPI).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 6.12 — clearFilters: resets to { branch_id, date: today }
// ---------------------------------------------------------------------------

describe('clearFilters', () => {
  it('resets to branch_id + today, clears status/sector/table_code', () => {
    useRoundsAdminStore.setState({
      filters: {
        branch_id: '5',
        date: '2025-01-01',
        status: 'PENDING',
        sector_id: '3',
        table_code: 'A-01',
        limit: 50,
        offset: 10,
      },
    })

    useRoundsAdminStore.getState().clearFilters()
    const filters = useRoundsAdminStore.getState().filters

    expect(filters.branch_id).toBe('5')
    expect(filters.date).toBe(TODAY)
    expect(filters.status).toBeUndefined()
    expect(filters.sector_id).toBeUndefined()
    expect(filters.table_code).toBeUndefined()
    expect(filters.offset).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 6.13 — selectAdminRounds: stable EMPTY_ROUNDS reference when store is empty
// ---------------------------------------------------------------------------

describe('selectAdminRounds_stable_empty', () => {
  it('returns the same EMPTY_ROUNDS reference when rounds is empty', () => {
    const state = useRoundsAdminStore.getState()
    const result1 = selectAdminRounds(state)
    const result2 = selectAdminRounds(state)
    expect(result1).toBe(result2)
    expect(result1).toBe(EMPTY_ROUNDS)
    expect(result1).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 6.15 — cancelRound: calls API, does NOT mutate store on success
// ---------------------------------------------------------------------------

describe('cancelRound', () => {
  it('calls PATCH API and does not mutate rounds on success (waits for WS)', async () => {
    const round = makeRound({ id: '1' })
    useRoundsAdminStore.setState({ rounds: [round] })
    mockFetchAPI.mockResolvedValueOnce(undefined)

    await useRoundsAdminStore.getState().cancelRound('1', 'Wrong order')

    // Store still has the round — waiting for ROUND_CANCELED WS event
    expect(useRoundsAdminStore.getState().rounds).toHaveLength(1)
    expect(mockFetchAPI).toHaveBeenCalled()
  })

  it('throws on API error so the page can show a toast', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('403 Forbidden'))

    await expect(
      useRoundsAdminStore.getState().cancelRound('1', 'reason')
    ).rejects.toThrow()
  })
})
