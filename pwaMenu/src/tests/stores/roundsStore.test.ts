/**
 * Unit tests for roundsStore.
 * Tests: ROUND_* status transitions, session filtering, dedup, upsertRound.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRoundsStore, selectRounds, selectHasReady } from '../../stores/roundsStore'
import type { RoundWsEvent } from '../../types/round'
import type { Round } from '../../types/round'

// Mock sessionStore to return sessionId '12'
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({ sessionId: '12' }),
  },
}))

const SESSION_ID = 12

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: '7',
    sessionId: '12',
    roundNumber: 1,
    status: 'PENDING',
    items: [],
    notes: '',
    submittedAt: '2026-04-18T12:00:00Z',
    readyAt: null,
    servedAt: null,
    ...overrides,
  }
}

function resetStore() {
  useRoundsStore.setState({ rounds: {}, _processedIds: [], _processedIdsSet: new Set<string>() })
}

describe('roundsStore', () => {
  beforeEach(() => {
    resetStore()
  })

  describe('setRounds', () => {
    it('replaces rounds with fetched list', () => {
      useRoundsStore.getState().setRounds([makeRound({ id: '7' }), makeRound({ id: '8', roundNumber: 2 })])
      const state = useRoundsStore.getState()
      expect(Object.keys(state.rounds)).toHaveLength(2)
    })
  })

  describe('upsertRound', () => {
    it('inserts a round from POST response', () => {
      useRoundsStore.getState().upsertRound(makeRound())
      expect(useRoundsStore.getState().rounds['7']).toBeDefined()
    })

    it('updates existing round', () => {
      useRoundsStore.getState().upsertRound(makeRound({ status: 'PENDING' }))
      useRoundsStore.getState().upsertRound(makeRound({ status: 'CONFIRMED' }))
      expect(useRoundsStore.getState().rounds['7'].status).toBe('CONFIRMED')
    })
  })

  describe('applyWsEvent — status transitions', () => {
    it('PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED', () => {
      useRoundsStore.getState().upsertRound(makeRound())

      const steps: Array<{ event: Partial<RoundWsEvent>; expectedStatus: string }> = [
        { event: { type: 'ROUND_CONFIRMED', event_id: 'e1', session_id: SESSION_ID, round_id: 7 }, expectedStatus: 'CONFIRMED' },
        { event: { type: 'ROUND_SUBMITTED', event_id: 'e2', session_id: SESSION_ID, round_id: 7, submitted_at: '2026-04-18T12:01:00Z' }, expectedStatus: 'SUBMITTED' },
        { event: { type: 'ROUND_IN_KITCHEN', event_id: 'e3', session_id: SESSION_ID, round_id: 7 }, expectedStatus: 'IN_KITCHEN' },
        { event: { type: 'ROUND_READY', event_id: 'e4', session_id: SESSION_ID, round_id: 7, ready_at: '2026-04-18T14:30:00Z' }, expectedStatus: 'READY' },
        { event: { type: 'ROUND_SERVED', event_id: 'e5', session_id: SESSION_ID, round_id: 7, served_at: '2026-04-18T14:35:00Z' }, expectedStatus: 'SERVED' },
      ]

      for (const { event, expectedStatus } of steps) {
        useRoundsStore.getState().applyWsEvent(event as RoundWsEvent)
        expect(useRoundsStore.getState().rounds['7'].status).toBe(expectedStatus)
      }
    })

    it('ROUND_READY updates readyAt timestamp', () => {
      useRoundsStore.getState().upsertRound(makeRound({ status: 'IN_KITCHEN', readyAt: null }))

      useRoundsStore.getState().applyWsEvent({
        type: 'ROUND_READY',
        event_id: 'e-ready',
        session_id: SESSION_ID,
        round_id: 7,
        ready_at: '2026-04-18T14:30:00Z',
      } as RoundWsEvent)

      const round = useRoundsStore.getState().rounds['7']
      expect(round.status).toBe('READY')
      expect(round.readyAt).toBe('2026-04-18T14:30:00Z')
    })

    it('ROUND_CANCELED sets status to CANCELED', () => {
      useRoundsStore.getState().upsertRound(makeRound())

      useRoundsStore.getState().applyWsEvent({
        type: 'ROUND_CANCELED',
        event_id: 'e-cancel',
        session_id: SESSION_ID,
        round_id: 7,
      } as RoundWsEvent)

      expect(useRoundsStore.getState().rounds['7'].status).toBe('CANCELED')
    })
  })

  describe('session filtering', () => {
    it('ignores events for a different session', () => {
      useRoundsStore.getState().upsertRound(makeRound({ status: 'PENDING' }))

      // Event from session 99 — should be ignored
      useRoundsStore.getState().applyWsEvent({
        type: 'ROUND_CONFIRMED',
        event_id: 'e-other',
        session_id: 99, // different session
        round_id: 7,
      } as RoundWsEvent)

      // Status should remain PENDING
      expect(useRoundsStore.getState().rounds['7'].status).toBe('PENDING')
    })
  })

  describe('deduplication', () => {
    it('ignores duplicate event_id', () => {
      useRoundsStore.getState().upsertRound(makeRound({ status: 'PENDING' }))

      const event: RoundWsEvent = {
        type: 'ROUND_CONFIRMED',
        event_id: 'e-dup',
        session_id: SESSION_ID,
        round_id: 7,
      }

      useRoundsStore.getState().applyWsEvent(event)
      expect(useRoundsStore.getState().rounds['7'].status).toBe('CONFIRMED')

      // Revert manually to test dedup
      useRoundsStore.setState((s) => ({
        rounds: { ...s.rounds, '7': { ...s.rounds['7'], status: 'PENDING' } },
      }))

      // Send same event again — should be ignored (dedup)
      useRoundsStore.getState().applyWsEvent(event)
      // Status stays PENDING because the event was deduped
      expect(useRoundsStore.getState().rounds['7'].status).toBe('PENDING')
    })
  })

  describe('selectHasReady', () => {
    it('returns true when any round is READY', () => {
      useRoundsStore.getState().upsertRound(makeRound({ status: 'READY' }))
      expect(selectHasReady(useRoundsStore.getState())).toBe(true)
    })

    it('returns false when no round is READY', () => {
      useRoundsStore.getState().upsertRound(makeRound({ status: 'SERVED' }))
      expect(selectHasReady(useRoundsStore.getState())).toBe(false)
    })
  })

  describe('selectRounds', () => {
    it('returns EMPTY_ARRAY reference when no rounds', () => {
      const state = useRoundsStore.getState()
      const r1 = selectRounds(state)
      const r2 = selectRounds(state)
      expect(r1).toBe(r2)
      expect(r1).toHaveLength(0)
    })
  })
})
