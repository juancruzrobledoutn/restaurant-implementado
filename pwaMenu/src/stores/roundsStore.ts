/**
 * Rounds store for pwaMenu.
 *
 * Tracks rounds for the current session, keyed by round_id (string).
 * Updated by: initial fetch, WS events (filtered by sessionId), and POST response.
 * WS events are deduplicated by event_id (FIFO set, capacity 200).
 *
 * Patterns:
 * - NEVER destructure from store — use selectors
 * - useShallow for object/array selectors
 */
import { create } from 'zustand'
import { toStringId } from '../utils/idConversion'
import { logger } from '../utils/logger'
import { useSessionStore } from './sessionStore'
import type { Round, RoundStatus, RoundWsEvent } from '../types/round'
import type {
  WsRoundReadyEvent,
  WsRoundServedEvent,
} from '../types/wsEvents'

// --- Stable fallbacks ---
export const EMPTY_ROUNDS_RECORD: Record<string, Round> = {}
export const EMPTY_ROUNDS_ARRAY: Round[] = []

const EVENT_ID_CAPACITY = 200

// --- Store state interface ---

interface RoundsState {
  rounds: Record<string, Round>
  _processedIds: string[] // FIFO list for eviction ordering
  _processedIdsSet: Set<string> // Set for O(1) lookup

  // Actions
  setRounds: (rounds: Round[]) => void
  applyWsEvent: (event: RoundWsEvent) => void
  upsertRound: (round: Round) => void
  clear: () => void
}

export const useRoundsStore = create<RoundsState>()((set, get) => ({
  rounds: EMPTY_ROUNDS_RECORD,
  _processedIds: [],
  _processedIdsSet: new Set<string>(),

  setRounds(rounds) {
    const record: Record<string, Round> = {}
    for (const round of rounds) {
      record[round.id] = round
    }
    set({ rounds: record })
  },

  applyWsEvent(event) {
    const { _processedIds, _processedIdsSet } = get()

    // Session filter — ignore events for other sessions
    const currentSessionId = useSessionStore.getState().sessionId
    if (currentSessionId !== null && toStringId(event.session_id) !== currentSessionId) {
      logger.debug('roundsStore: ignoring event for other session', {
        eventSession: event.session_id,
        currentSession: currentSessionId,
      })
      return
    }

    // Deduplication — O(1) Set lookup instead of O(n) Array.includes
    if (_processedIdsSet.has(event.event_id)) {
      logger.debug('roundsStore: duplicate event_id ignored', { event_id: event.event_id })
      return
    }

    const nextIds = [..._processedIds]
    const nextSet = new Set(_processedIdsSet)
    if (nextIds.length >= EVENT_ID_CAPACITY) {
      const evicted = nextIds.shift()
      if (evicted !== undefined) nextSet.delete(evicted)
    }
    nextIds.push(event.event_id)
    nextSet.add(event.event_id)

    const roundId = toStringId(event.round_id)

    switch (event.type) {
      case 'ROUND_PENDING': {
        set((state) => {
          const existing = state.rounds[roundId]
          const updated: Round = {
            id: roundId,
            sessionId: toStringId(event.session_id),
            roundNumber: event.round_number ?? existing?.roundNumber ?? 0,
            status: 'PENDING',
            items: existing?.items ?? [],
            notes: existing?.notes ?? '',
            submittedAt: event.submitted_at ?? existing?.submittedAt ?? new Date().toISOString(),
            readyAt: existing?.readyAt ?? null,
            servedAt: existing?.servedAt ?? null,
          }
          return {
            rounds: { ...state.rounds, [roundId]: updated },
            _processedIds: nextIds,
            _processedIdsSet: nextSet,
          }
        })
        break
      }

      case 'ROUND_CONFIRMED': {
        set((state) => {
          const existing = state.rounds[roundId]
          if (!existing) return { _processedIds: nextIds, _processedIdsSet: nextSet }
          return {
            rounds: { ...state.rounds, [roundId]: { ...existing, status: 'CONFIRMED' } },
            _processedIds: nextIds,
            _processedIdsSet: nextSet,
          }
        })
        break
      }

      case 'ROUND_SUBMITTED': {
        set((state) => {
          const existing = state.rounds[roundId]
          if (!existing) return { _processedIds: nextIds, _processedIdsSet: nextSet }
          return {
            rounds: {
              ...state.rounds,
              [roundId]: {
                ...existing,
                status: 'SUBMITTED',
                submittedAt: event.submitted_at ?? existing.submittedAt,
              },
            },
            _processedIds: nextIds,
            _processedIdsSet: nextSet,
          }
        })
        break
      }

      case 'ROUND_IN_KITCHEN': {
        set((state) => {
          const existing = state.rounds[roundId]
          if (!existing) return { _processedIds: nextIds, _processedIdsSet: nextSet }
          return {
            rounds: { ...state.rounds, [roundId]: { ...existing, status: 'IN_KITCHEN' } },
            _processedIds: nextIds,
            _processedIdsSet: nextSet,
          }
        })
        break
      }

      case 'ROUND_READY': {
        const e = event as unknown as WsRoundReadyEvent
        set((state) => {
          const existing = state.rounds[roundId]
          if (!existing) return { _processedIds: nextIds, _processedIdsSet: nextSet }
          return {
            rounds: {
              ...state.rounds,
              [roundId]: {
                ...existing,
                status: 'READY',
                readyAt: e.ready_at ?? existing.readyAt,
              },
            },
            _processedIds: nextIds,
            _processedIdsSet: nextSet,
          }
        })
        break
      }

      case 'ROUND_SERVED': {
        const e = event as unknown as WsRoundServedEvent
        set((state) => {
          const existing = state.rounds[roundId]
          if (!existing) return { _processedIds: nextIds, _processedIdsSet: nextSet }
          return {
            rounds: {
              ...state.rounds,
              [roundId]: {
                ...existing,
                status: 'SERVED',
                servedAt: e.served_at ?? existing.servedAt,
              },
            },
            _processedIds: nextIds,
            _processedIdsSet: nextSet,
          }
        })
        break
      }

      case 'ROUND_CANCELED': {
        set((state) => {
          const existing = state.rounds[roundId]
          if (!existing) return { _processedIds: nextIds, _processedIdsSet: nextSet }
          return {
            rounds: { ...state.rounds, [roundId]: { ...existing, status: 'CANCELED' } },
            _processedIds: nextIds,
            _processedIdsSet: nextSet,
          }
        })
        break
      }

      default:
        set({ _processedIds: nextIds, _processedIdsSet: nextSet })
    }
  },

  upsertRound(round) {
    set((state) => ({
      rounds: { ...state.rounds, [round.id]: round },
    }))
  },

  clear() {
    set({ rounds: EMPTY_ROUNDS_RECORD, _processedIds: [], _processedIdsSet: new Set<string>() })
  },
}))

// --- Selectors ---

export const selectRoundsRecord = (s: RoundsState): Record<string, Round> => s.rounds

export const selectRounds = (s: RoundsState): Round[] =>
  Object.keys(s.rounds).length === 0 ? EMPTY_ROUNDS_ARRAY : Object.values(s.rounds)

export function selectRoundsByStatus(status: RoundStatus) {
  return (s: RoundsState): Round[] =>
    Object.values(s.rounds).filter((r) => r.status === status)
}

export const selectLatestRound = (s: RoundsState): Round | null => {
  const rounds = Object.values(s.rounds)
  if (rounds.length === 0) return null
  return rounds.reduce((latest, r) =>
    r.submittedAt > latest.submittedAt ? r : latest,
  )
}

export const selectHasReady = (s: RoundsState): boolean =>
  Object.values(s.rounds).some((r) => r.status === 'READY')
