/**
 * roundsStore tests — upsert idempotence, status transitions, selectors.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRoundsStore, useRoundsBySession, usePendingRounds, useReadyRounds } from '@/stores/roundsStore'
import type { Round } from '@/stores/roundsStore'

const ROUND_1: Round = {
  id: 'r-1',
  sessionId: 'sess-1',
  status: 'PENDING',
  items: [{ id: 'i-1', productId: 'p-100', quantity: 2 }],
  createdAt: '2026-04-18T10:00:00Z',
}

const ROUND_2: Round = {
  id: 'r-2',
  sessionId: 'sess-1',
  status: 'IN_KITCHEN',
  items: [],
  createdAt: '2026-04-18T10:01:00Z',
}

describe('roundsStore', () => {
  beforeEach(() => {
    useRoundsStore.setState({ bySession: {} })
  })

  it('upsertRound inserts a round under its sessionId', () => {
    useRoundsStore.getState().upsertRound(ROUND_1)
    const state = useRoundsStore.getState()
    expect(state.bySession['sess-1']?.['r-1']).toEqual(ROUND_1)
  })

  it('upsertRound is idempotent — re-upserting replaces the round', () => {
    useRoundsStore.getState().upsertRound(ROUND_1)
    const updated: Round = { ...ROUND_1, status: 'CONFIRMED' }
    useRoundsStore.getState().upsertRound(updated)

    const state = useRoundsStore.getState()
    expect(state.bySession['sess-1']?.['r-1']?.status).toBe('CONFIRMED')
    // Only one entry
    expect(Object.keys(state.bySession['sess-1'] ?? {}).length).toBe(1)
  })

  it('updateRoundStatus applies the new status', () => {
    useRoundsStore.getState().upsertRound(ROUND_1)
    useRoundsStore.getState().updateRoundStatus('r-1', 'CONFIRMED')

    expect(useRoundsStore.getState().bySession['sess-1']?.['r-1']?.status).toBe('CONFIRMED')
  })

  it('updateRoundStatus is a no-op for unknown roundId', () => {
    useRoundsStore.getState().upsertRound(ROUND_1)
    const before = useRoundsStore.getState().bySession
    useRoundsStore.getState().updateRoundStatus('non-existent', 'SERVED')
    expect(useRoundsStore.getState().bySession).toBe(before)
  })

  it('removeRound deletes a round from its session', () => {
    useRoundsStore.getState().upsertRound(ROUND_1)
    useRoundsStore.getState().upsertRound(ROUND_2)
    useRoundsStore.getState().removeRound('r-1')

    const sessionRounds = useRoundsStore.getState().bySession['sess-1'] ?? {}
    expect('r-1' in sessionRounds).toBe(false)
    expect('r-2' in sessionRounds).toBe(true)
  })

  it('clearSession removes all rounds for the session', () => {
    useRoundsStore.getState().upsertRound(ROUND_1)
    useRoundsStore.getState().upsertRound(ROUND_2)
    useRoundsStore.getState().clearSession('sess-1')

    expect(useRoundsStore.getState().bySession['sess-1']).toBeUndefined()
  })

  it('useRoundsBySession returns stable reference via useShallow', () => {
    useRoundsStore.getState().upsertRound(ROUND_1)

    const { result, rerender } = renderHook(() => useRoundsBySession('sess-1'))
    const first = result.current
    expect(first).toHaveLength(1)

    rerender()
    expect(result.current).toBe(first) // same reference
  })

  it('useRoundsBySession returns new reference after upsertRound status change (HTTP confirm path)', () => {
    // Simulate: round in store from ROUND_PENDING WS event
    useRoundsStore.getState().upsertRound(ROUND_1) // PENDING

    const { result } = renderHook(() => useRoundsBySession('sess-1'))
    const beforeConfirm = result.current
    expect(beforeConfirm[0]?.status).toBe('PENDING')

    // Simulate: HTTP response from confirmRound() → upsertRound with CONFIRMED
    // Must be wrapped in act() so React flushes the Zustand subscription and re-renders
    act(() => {
      const confirmed: Round = { ...ROUND_1, status: 'CONFIRMED' }
      useRoundsStore.getState().upsertRound(confirmed)
    })

    expect(result.current[0]?.status).toBe('CONFIRMED')
    // Different reference — selector detected the change → component re-rendered
    expect(result.current).not.toBe(beforeConfirm)
  })

  it('useRoundsBySession returns new reference after updateRoundStatus (WS event path)', () => {
    // Simulate: round in store from ROUND_PENDING WS event
    useRoundsStore.getState().upsertRound(ROUND_1) // PENDING

    const { result } = renderHook(() => useRoundsBySession('sess-1'))
    const beforeConfirm = result.current
    expect(beforeConfirm[0]?.status).toBe('PENDING')

    // Simulate: ROUND_CONFIRMED WS event → updateRoundStatus (now synchronous, no lazy import race)
    act(() => {
      useRoundsStore.getState().updateRoundStatus('r-1', 'CONFIRMED')
    })

    expect(result.current[0]?.status).toBe('CONFIRMED')
    expect(result.current).not.toBe(beforeConfirm)
  })

  it('usePendingRounds filters only PENDING rounds', () => {
    useRoundsStore.getState().upsertRound(ROUND_1) // PENDING
    useRoundsStore.getState().upsertRound(ROUND_2) // IN_KITCHEN

    const { result } = renderHook(() => usePendingRounds('sess-1'))
    expect(result.current).toHaveLength(1)
    expect(result.current[0]?.status).toBe('PENDING')
  })

  it('useReadyRounds filters only READY rounds', () => {
    useRoundsStore.getState().upsertRound(ROUND_1) // PENDING
    useRoundsStore.getState().upsertRound({ ...ROUND_2, status: 'READY' })

    const { result } = renderHook(() => useReadyRounds('sess-1'))
    expect(result.current).toHaveLength(1)
    expect(result.current[0]?.status).toBe('READY')
  })
})
