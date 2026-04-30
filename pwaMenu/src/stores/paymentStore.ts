/**
 * Payment store for pwaMenu (C-19 / Task 6.2).
 *
 * Explicit FSM with validated transitions.
 * Invalid transitions log a warning and do NOT mutate state (fail-safe).
 *
 * FSM transitions:
 *   idle → creating_preference  (user clicks Pagar MP)
 *   creating_preference → redirecting  (preference created, redirect imminent)
 *   creating_preference → failed       (API error)
 *   redirecting → waiting              (window.location.assign called)
 *   waiting → approved                 (WS PAYMENT_APPROVED or polling confirms)
 *   waiting → rejected                 (WS PAYMENT_REJECTED or polling confirms)
 *   waiting → failed                   (timeout / mismatch)
 *   approved → idle                    (session cleared)
 *   rejected → creating_preference     (user retries)
 *   rejected → idle                    (user cancels)
 *   failed → creating_preference       (user retries)
 *   failed → idle                      (user cancels)
 *   * → idle                           (reset() from anywhere)
 *
 * Patterns (NON-NEGOTIABLE):
 * - NEVER destructure from store — use selectors
 * - useShallow for object selectors
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { logger } from '../utils/logger'
import type { PaymentPhase, PaymentError } from '../types/billing'

// --- Valid FSM transitions map ---
// Key: current phase → Set of valid next phases
const VALID_TRANSITIONS: Readonly<Record<PaymentPhase, ReadonlySet<PaymentPhase>>> = {
  // idle → failed handles "orphaned redirect": MP sends user back after browser reload,
  // the store is fresh (idle) but the URL params indicate a terminal result.
  idle: new Set<PaymentPhase>(['creating_preference', 'failed']),
  creating_preference: new Set<PaymentPhase>(['redirecting', 'failed', 'idle']),
  redirecting: new Set<PaymentPhase>(['waiting', 'failed', 'idle']),
  waiting: new Set<PaymentPhase>(['approved', 'rejected', 'failed', 'idle']),
  approved: new Set<PaymentPhase>(['idle']),
  rejected: new Set<PaymentPhase>(['creating_preference', 'idle']),
  failed: new Set<PaymentPhase>(['creating_preference', 'idle']),
}

// --- Store state interface ---

interface PaymentState {
  phase: PaymentPhase
  preferenceId: string | null
  paymentId: string | null       // MP payment_id returned from redirect
  externalId: string | null      // MP external_reference
  error: PaymentError | null
  startedAt: number | null       // Unix ms when flow began (for timeout)
  pollingAttempts: number        // How many polling rounds have been made

  // Actions
  transition: (to: PaymentPhase, meta?: Partial<PaymentTransitionMeta>) => void
  setPreferenceId: (id: string) => void
  setPaymentId: (id: string) => void
  incrementPolling: () => void
  reset: () => void
}

interface PaymentTransitionMeta {
  error?: PaymentError
  preferenceId?: string
  paymentId?: string
}

const initialState: Omit<PaymentState, 'transition' | 'setPreferenceId' | 'setPaymentId' | 'incrementPolling' | 'reset'> = {
  phase: 'idle',
  preferenceId: null,
  paymentId: null,
  externalId: null,
  error: null,
  startedAt: null,
  pollingAttempts: 0,
}

export const usePaymentStore = create<PaymentState>()((set, get) => ({
  ...initialState,

  /**
   * Validated state transition.
   * Invalid transitions log WARN and do NOT mutate state (fail-safe FSM).
   */
  transition(to: PaymentPhase, meta?: Partial<PaymentTransitionMeta>) {
    const from = get().phase

    // Reset is always allowed — skip validation
    if (to === 'idle') {
      set({
        phase: 'idle',
        error: null,
        // Keep preferenceId / paymentId for audit if transitioning from approved/rejected
      })
      logger.info('paymentStore.transition: reset to idle', { from })
      return
    }

    const allowed = VALID_TRANSITIONS[from]
    if (!allowed.has(to)) {
      logger.warn('paymentStore.transition: INVALID transition (state NOT mutated)', {
        from,
        to,
        allowed: [...allowed],
      })
      return
    }

    const nextState: Partial<PaymentState> = { phase: to }

    if (meta?.error) nextState.error = meta.error
    if (meta?.preferenceId) nextState.preferenceId = meta.preferenceId
    if (meta?.paymentId) nextState.paymentId = meta.paymentId

    // Track when the flow started (first non-idle transition)
    if (from === 'idle' && to === 'creating_preference') {
      nextState.startedAt = Date.now()
      nextState.pollingAttempts = 0
      nextState.error = null
    }

    set(nextState)
    logger.info('paymentStore.transition', { from, to })
  },

  setPreferenceId(id: string) {
    set({ preferenceId: id })
  },

  setPaymentId(id: string) {
    set({ paymentId: id })
  },

  incrementPolling() {
    set((s) => ({ pollingAttempts: s.pollingAttempts + 1 }))
  },

  /**
   * Full reset — returns to idle, clears all state including IDs.
   */
  reset() {
    set({ ...initialState })
    logger.info('paymentStore.reset')
  },
}))

// ── Selectors ──────────────────────────────────────────────────────────────────

export const selectPaymentPhase = (s: PaymentState) => s.phase
export const selectPreferenceId = (s: PaymentState) => s.preferenceId
export const selectPaymentId = (s: PaymentState) => s.paymentId
export const selectPaymentError = (s: PaymentState) => s.error
export const selectPollingAttempts = (s: PaymentState) => s.pollingAttempts
export const selectStartedAt = (s: PaymentState) => s.startedAt

export const selectIsPaymentActive = (s: PaymentState) =>
  s.phase !== 'idle' && s.phase !== 'approved' && s.phase !== 'rejected' && s.phase !== 'failed'

export const selectIsCreatingPreference = (s: PaymentState) =>
  s.phase === 'creating_preference'

export const usePaymentActions = () =>
  usePaymentStore(
    useShallow((s) => ({
      transition: s.transition,
      setPreferenceId: s.setPreferenceId,
      setPaymentId: s.setPaymentId,
      incrementPolling: s.incrementPolling,
      reset: s.reset,
    })),
  )
