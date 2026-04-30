/**
 * roundsStore — tracks rounds per table session, updated by WS events.
 *
 * Shape: { bySession: Record<sessionId, Record<roundId, Round>> }
 *
 * Valid status transitions (from knowledge-base/01-negocio/04_reglas_de_negocio.md §2):
 *   PENDING → CONFIRMED (waiter confirms) | CANCELED
 *   CONFIRMED → SUBMITTED (manager/admin) | CANCELED
 *   SUBMITTED → IN_KITCHEN
 *   IN_KITCHEN → READY
 *   READY → SERVED
 *   SERVED → (terminal)
 *   CANCELED → (terminal)
 *
 * Rules (zustand-store-pattern skill):
 * - NEVER destructure — use named selectors
 * - useShallow for array selectors
 * - EMPTY_ARRAY stable fallback
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { EMPTY_ARRAY } from '@/lib/constants'
import { logger } from '@/utils/logger'
import type { RoundDTO } from '@/services/waiter'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoundStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'SUBMITTED'
  | 'IN_KITCHEN'
  | 'READY'
  | 'SERVED'
  | 'CANCELED'

export interface RoundItem {
  id: string
  productId: string
  quantity: number
  notes?: string | null
}

export interface Round {
  id: string
  sessionId: string
  status: RoundStatus
  items: RoundItem[]
  createdAt: string
}

// Valid forward transitions
const VALID_TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELED'],
  CONFIRMED: ['SUBMITTED', 'CANCELED'],
  SUBMITTED: ['IN_KITCHEN'],
  IN_KITCHEN: ['READY'],
  READY: ['SERVED'],
  SERVED: [],
  CANCELED: [],
}

function isValidTransition(from: RoundStatus, to: RoundStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type SessionRounds = Record<string, Round>

interface RoundsState {
  bySession: Record<string, SessionRounds>

  // Actions
  upsertRound: (round: Round | RoundDTO) => void
  updateRoundStatus: (roundId: string, newStatus: RoundStatus) => void
  removeRound: (roundId: string) => void
  clearSession: (sessionId: string) => void
}

// Stable empty fallback
const EMPTY_ROUNDS: Round[] = EMPTY_ARRAY as unknown as Round[]

/** Normalize RoundDTO (from API) to Round (frontend shape). */
function normalizeRound(raw: Round | RoundDTO): Round {
  if ('sessionId' in raw) {
    // Already a Round
    return raw as Round
  }
  // RoundDTO
  const dto = raw as RoundDTO
  return {
    id: dto.id,
    sessionId: dto.sessionId,
    status: dto.status as RoundStatus,
    items: dto.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      quantity: i.quantity,
      notes: i.notes,
    })),
    createdAt: dto.createdAt,
  }
}

export const useRoundsStore = create<RoundsState>()((set, _get) => ({
  bySession: {},

  // ------------------------------------------------------------------
  // upsertRound — idempotent by roundId
  // ------------------------------------------------------------------
  upsertRound: (raw) => {
    const round = normalizeRound(raw)
    set((state) => {
      const sessionRounds = { ...(state.bySession[round.sessionId] ?? {}) }
      sessionRounds[round.id] = round
      return {
        bySession: { ...state.bySession, [round.sessionId]: sessionRounds },
      }
    })
  },

  // ------------------------------------------------------------------
  // updateRoundStatus — validates transition before applying
  // ------------------------------------------------------------------
  updateRoundStatus: (roundId, newStatus) => {
    set((state) => {
      // Find the round across all sessions
      for (const [sessionId, sessionRounds] of Object.entries(state.bySession)) {
        if (roundId in sessionRounds) {
          const existing = sessionRounds[roundId]!
          const currentStatus = existing.status

          if (!isValidTransition(currentStatus, newStatus)) {
            logger.warn(
              `roundsStore: invalid transition ${currentStatus} → ${newStatus} for round ${roundId}`,
            )
            // Still apply it — server is the authority; just log the anomaly
          }

          const updated: Round = { ...existing, status: newStatus }
          return {
            bySession: {
              ...state.bySession,
              [sessionId]: { ...sessionRounds, [roundId]: updated },
            },
          }
        }
      }
      logger.warn(`roundsStore: updateRoundStatus — round ${roundId} not found`)
      return state
    })
  },

  // ------------------------------------------------------------------
  // removeRound — called only on TABLE_CLEARED
  // ------------------------------------------------------------------
  removeRound: (roundId) => {
    set((state) => {
      const nextBySession: Record<string, SessionRounds> = {}
      for (const [sessionId, sessionRounds] of Object.entries(state.bySession)) {
        if (roundId in sessionRounds) {
          const next = { ...sessionRounds }
          delete next[roundId]
          nextBySession[sessionId] = next
        } else {
          nextBySession[sessionId] = sessionRounds
        }
      }
      return { bySession: nextBySession }
    })
  },

  // ------------------------------------------------------------------
  // clearSession — drop all rounds for a session (TABLE_CLEARED)
  // ------------------------------------------------------------------
  clearSession: (sessionId) => {
    set((state) => {
      const next = { ...state.bySession }
      delete next[sessionId]
      return { bySession: next }
    })
  },
}))

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** All rounds for a session as array — useShallow required. */
export function useRoundsBySession(sessionId: string): Round[] {
  return useRoundsStore(
    useShallow((s) => {
      const sessionMap = s.bySession[sessionId]
      if (!sessionMap) return EMPTY_ROUNDS
      return Object.values(sessionMap)
    }),
  )
}

/** Pending rounds for a session (PENDING status). */
export function usePendingRounds(sessionId: string): Round[] {
  return useRoundsStore(
    useShallow((s) => {
      const sessionMap = s.bySession[sessionId]
      if (!sessionMap) return EMPTY_ROUNDS
      return Object.values(sessionMap).filter((r) => r.status === 'PENDING')
    }),
  )
}

/** Ready rounds for a session (READY status). */
export function useReadyRounds(sessionId: string): Round[] {
  return useRoundsStore(
    useShallow((s) => {
      const sessionMap = s.bySession[sessionId]
      if (!sessionMap) return EMPTY_ROUNDS
      return Object.values(sessionMap).filter((r) => r.status === 'READY')
    }),
  )
}

/** Non-reactive access for deriveVisualState and WS handlers. */
export const selectRoundsBySessionRaw = (sessionId: string) =>
  (s: RoundsState): Round[] => {
    const sessionMap = s.bySession[sessionId]
    if (!sessionMap) return EMPTY_ROUNDS
    return Object.values(sessionMap)
  }
