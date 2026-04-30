/**
 * Billing store for pwaMenu (C-19 / Task 6.1).
 *
 * Holds the current Check (app_check) for the active table session.
 *
 * Patterns (NON-NEGOTIABLE):
 * - NEVER destructure from store — use selectors
 * - useShallow for object/array selectors
 * - EMPTY_ARRAY as stable reference (no inline `?? []`)
 * - NO direct persistence — billing state is session-volatile
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { logger } from '../utils/logger'
import type { Check, Charge, Payment, CheckStatus, SplitMethod } from '../types/billing'

// --- Stable fallbacks (reference-stable) ---
const EMPTY_CHARGES: Charge[] = []
const EMPTY_PAYMENTS: Payment[] = []

// --- Store state interface ---

interface BillingState {
  // Data
  checkId: string | null
  sessionId: string | null
  status: CheckStatus | null
  splitMethod: SplitMethod | null
  totalCents: number
  charges: Charge[]
  payments: Payment[]
  remainingCents: number
  loadedAt: number | null // Unix ms, for freshness checks

  // Actions
  setCheck: (check: Check) => void
  updateStatus: (status: CheckStatus) => void
  addPayment: (payment: Payment) => void
  reset: () => void
}

const initialState = {
  checkId: null,
  sessionId: null,
  status: null,
  splitMethod: null,
  totalCents: 0,
  charges: EMPTY_CHARGES,
  payments: EMPTY_PAYMENTS,
  remainingCents: 0,
  loadedAt: null,
}

export const useBillingStore = create<BillingState>()((set, get) => ({
  ...initialState,

  /**
   * Idempotent: set (or replace) the check.
   * Updates loadedAt to the current timestamp.
   */
  setCheck(check: Check) {
    set({
      checkId: check.id,
      sessionId: check.sessionId,
      status: check.status,
      splitMethod: check.splitMethod,
      totalCents: check.totalCents,
      charges: check.charges.length > 0 ? check.charges : EMPTY_CHARGES,
      payments: check.payments.length > 0 ? check.payments : EMPTY_PAYMENTS,
      remainingCents: check.remainingCents,
      loadedAt: Date.now(),
    })
    logger.debug('billingStore.setCheck', { checkId: check.id, status: check.status })
  },

  /**
   * Update the check status (typically from WS event).
   */
  updateStatus(status: CheckStatus) {
    const prev = get().status
    if (prev === status) return
    set({ status })
    logger.info('billingStore.updateStatus', { prev, next: status })
  },

  /**
   * Add or update a payment record (from WS PAYMENT_APPROVED / PAYMENT_REJECTED).
   * Idempotent by payment id.
   */
  addPayment(payment: Payment) {
    const current = get().payments
    const idx = current.findIndex((p) => p.id === payment.id)
    if (idx === -1) {
      set({ payments: [...current, payment] })
    } else {
      const updated = [...current]
      updated[idx] = payment
      set({ payments: updated })
    }
    logger.debug('billingStore.addPayment', { paymentId: payment.id, status: payment.status })
  },

  /**
   * Reset to initial state (on session clear or CLOSED status).
   */
  reset() {
    set(initialState)
    logger.info('billingStore.reset')
  },
}))

// ── Selectors ──────────────────────────────────────────────────────────────────

export const selectCheckId = (s: BillingState) => s.checkId
export const selectBillingStatus = (s: BillingState) => s.status
export const selectTotalCents = (s: BillingState) => s.totalCents
export const selectRemainingCents = (s: BillingState) => s.remainingCents
export const selectSplitMethod = (s: BillingState) => s.splitMethod
export const selectLoadedAt = (s: BillingState) => s.loadedAt

/**
 * Stable selector for charges array — use with useShallow.
 * @example const charges = useBillingStore(useShallow(selectCharges))
 */
export const selectCharges = (s: BillingState) => s.charges

/**
 * Stable selector for payments array — use with useShallow.
 */
export const selectPayments = (s: BillingState) => s.payments

/**
 * Derived: true if billing check is active (status is REQUESTED or OPEN).
 */
export const selectIsCheckActive = (s: BillingState) =>
  s.status === 'REQUESTED' || s.status === 'OPEN'

/**
 * Derived: true if the check has been fully paid.
 */
export const selectIsCheckPaid = (s: BillingState) => s.status === 'PAID'

/**
 * Composite action selector — group with useShallow.
 */
export const useBillingActions = () =>
  useBillingStore(
    useShallow((s) => ({
      setCheck: s.setCheck,
      updateStatus: s.updateStatus,
      addPayment: s.addPayment,
      reset: s.reset,
    })),
  )
