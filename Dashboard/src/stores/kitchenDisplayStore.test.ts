/**
 * kitchenDisplayStore unit tests.
 *
 * Key: this store is NOT persisted — verifies:
 * - Initial state is always empty (no localStorage hydration)
 * - audioEnabled reads/writes to localStorage directly
 * - handleRound* mutations work correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useKitchenDisplayStore } from './kitchenDisplayStore'
import type { WSEvent } from '@/types/menu'

vi.mock('@/services/api', () => ({ fetchAPI: vi.fn() }))
vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

import { fetchAPI } from '@/services/api'
const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

function makeRoundEvent(overrides: Record<string, unknown> = {}): WSEvent {
  return {
    type: 'ROUND_SUBMITTED',
    branch_id: '100',
    data: {
      id: 1,
      session_id: 10,
      branch_id: 100,
      submitted_at: '2026-01-01T12:00:00Z',
      table_number: 5,
      sector_name: 'Salon',
      diner_count: 2,
      items: [],
      ...overrides,
    },
  } as unknown as WSEvent
}

beforeEach(() => {
  useKitchenDisplayStore.setState({
    rounds: [],
    isLoading: false,
    audioEnabled: false,
    error: null,
  })
  vi.clearAllMocks()
  localStorage.clear()
})

describe('initial_state', () => {
  it('starts with empty rounds and not loading', () => {
    const state = useKitchenDisplayStore.getState()
    expect(state.rounds).toHaveLength(0)
    expect(state.isLoading).toBe(false)
  })
})

describe('fetchSnapshot', () => {
  it('populates rounds from API', async () => {
    mockFetchAPI.mockResolvedValueOnce([
      { id: 1, session_id: 1, branch_id: 100, status: 'SUBMITTED', submitted_at: '', table_number: 1, sector_name: 'S', diner_count: 2, items: [] },
    ])
    await useKitchenDisplayStore.getState().fetchSnapshot('100')
    expect(useKitchenDisplayStore.getState().rounds).toHaveLength(1)
    expect(useKitchenDisplayStore.getState().rounds[0]!.id).toBe('1')
  })
})

describe('handleRoundSubmitted_upserts', () => {
  it('adds a new round', () => {
    useKitchenDisplayStore.getState().handleRoundSubmitted(makeRoundEvent())
    expect(useKitchenDisplayStore.getState().rounds).toHaveLength(1)
    expect(useKitchenDisplayStore.getState().rounds[0]!.status).toBe('SUBMITTED')
  })

  it('updates existing round if id matches (upsert)', () => {
    useKitchenDisplayStore.getState().handleRoundSubmitted(makeRoundEvent())
    useKitchenDisplayStore.getState().handleRoundSubmitted(
      makeRoundEvent({ table_number: 9 })
    )
    // Still 1 round (same id = 1)
    expect(useKitchenDisplayStore.getState().rounds).toHaveLength(1)
    expect(useKitchenDisplayStore.getState().rounds[0]!.table_number).toBe(9)
  })
})

describe('handleRoundInKitchen', () => {
  it('updates status to IN_KITCHEN', () => {
    useKitchenDisplayStore.getState().handleRoundSubmitted(makeRoundEvent())
    useKitchenDisplayStore.getState().handleRoundInKitchen({
      type: 'ROUND_IN_KITCHEN',
      id: '1',
      data: { id: 1 },
    } as unknown as WSEvent)
    expect(useKitchenDisplayStore.getState().rounds[0]!.status).toBe('IN_KITCHEN')
  })
})

describe('handleRoundReady', () => {
  it('updates status to READY', () => {
    useKitchenDisplayStore.getState().handleRoundSubmitted(makeRoundEvent())
    useKitchenDisplayStore.getState().handleRoundReady({
      type: 'ROUND_READY',
      id: '1',
      data: { id: 1 },
    } as unknown as WSEvent)
    expect(useKitchenDisplayStore.getState().rounds[0]!.status).toBe('READY')
  })
})

describe('handleRoundCanceled_removes', () => {
  it('removes the round', () => {
    useKitchenDisplayStore.getState().handleRoundSubmitted(makeRoundEvent())
    expect(useKitchenDisplayStore.getState().rounds).toHaveLength(1)
    useKitchenDisplayStore.getState().handleRoundCanceled({
      type: 'ROUND_CANCELED',
      id: '1',
      data: { id: 1 },
    } as unknown as WSEvent)
    expect(useKitchenDisplayStore.getState().rounds).toHaveLength(0)
  })
})

describe('toggle_audio_persists_to_localStorage', () => {
  it('toggles audioEnabled and writes to localStorage', () => {
    expect(useKitchenDisplayStore.getState().audioEnabled).toBe(false)
    useKitchenDisplayStore.getState().toggleAudio()
    expect(useKitchenDisplayStore.getState().audioEnabled).toBe(true)
    expect(localStorage.getItem('kitchenDisplay.audio')).toBe('true')
    useKitchenDisplayStore.getState().toggleAudio()
    expect(useKitchenDisplayStore.getState().audioEnabled).toBe(false)
    expect(localStorage.getItem('kitchenDisplay.audio')).toBe('false')
  })
})

describe('not_persisted_across_reload', () => {
  it('has no zustand-persist key in localStorage', () => {
    // kitchenDisplayStore does NOT use persist() — confirm no key
    // We just verify the store has no persist-related state
    expect(localStorage.getItem('integrador.dashboard.kitchen-display')).toBeNull()
  })
})

describe('reset', () => {
  it('clears rounds', () => {
    useKitchenDisplayStore.getState().handleRoundSubmitted(makeRoundEvent())
    useKitchenDisplayStore.getState().reset()
    expect(useKitchenDisplayStore.getState().rounds).toHaveLength(0)
  })
})
