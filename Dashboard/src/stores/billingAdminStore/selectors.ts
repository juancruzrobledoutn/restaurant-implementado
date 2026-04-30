/**
 * billingAdminStore selectors (C-26).
 *
 * Skill: zustand-store-pattern
 *
 * Rules:
 * - Plain selectors return primitives or stable array slices (no filtering)
 * - useShallow for grouped actions (object return)
 * - useMemo for derived values in hooks (KPIs, method summary)
 */

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useBillingAdminStore, EMPTY_CHECKS, EMPTY_PAYMENTS } from './store'
import type { BillingAdminState } from './types'
import type { ChecksKPIs, PaymentMethodSummaryRow, PaymentMethod } from '@/types/billing'

// ---------------------------------------------------------------------------
// Stable EMPTY references (re-exported for tests)
// ---------------------------------------------------------------------------

export { EMPTY_CHECKS, EMPTY_PAYMENTS }

// ---------------------------------------------------------------------------
// Checks selectors
// ---------------------------------------------------------------------------

export const selectChecks = (s: BillingAdminState) => s.checks ?? EMPTY_CHECKS
export const selectChecksTotal = (s: BillingAdminState) => s.checksTotal
export const selectChecksIsLoading = (s: BillingAdminState) => s.checksIsLoading
export const selectChecksError = (s: BillingAdminState) => s.checksError
export const selectChecksFilter = (s: BillingAdminState) => s.checksFilter

// ---------------------------------------------------------------------------
// Payments selectors
// ---------------------------------------------------------------------------

export const selectPayments = (s: BillingAdminState) => s.payments ?? EMPTY_PAYMENTS
export const selectPaymentsTotal = (s: BillingAdminState) => s.paymentsTotal
export const selectPaymentsIsLoading = (s: BillingAdminState) => s.paymentsIsLoading
export const selectPaymentsError = (s: BillingAdminState) => s.paymentsError
export const selectPaymentsFilter = (s: BillingAdminState) => s.paymentsFilter

// ---------------------------------------------------------------------------
// Derived selectors (hooks with useMemo)
// ---------------------------------------------------------------------------

/**
 * Derive ChecksKPIs from the current checks array.
 * Design D6: computed client-side, stays in sync with WS upserts.
 */
export function useChecksKPIs(): ChecksKPIs {
  const checks = useBillingAdminStore(selectChecks)
  return useMemo<ChecksKPIs>(() => {
    let totalBilledCents = 0
    let pendingChecks = 0
    for (const c of checks) {
      totalBilledCents += c.total_cents
      if (c.status === 'REQUESTED') pendingChecks++
    }
    return {
      totalChecks: checks.length,
      totalBilledCents,
      pendingChecks,
    }
  }, [checks])
}

/**
 * Derive payment method summary (APPROVED only) for the footer table.
 * Design D10: aggregated client-side; REJECTED/PENDING excluded (contable).
 */
export function usePaymentsByMethodSummary(): PaymentMethodSummaryRow[] {
  const payments = useBillingAdminStore(selectPayments)
  return useMemo<PaymentMethodSummaryRow[]>(() => {
    const map = new Map<PaymentMethod, { count: number; total_cents: number }>()
    for (const p of payments) {
      if (p.status !== 'APPROVED') continue
      const method = p.method as PaymentMethod
      const existing = map.get(method)
      if (existing) {
        existing.count++
        existing.total_cents += p.amount_cents
      } else {
        map.set(method, { count: 1, total_cents: p.amount_cents })
      }
    }
    return Array.from(map.entries()).map(([method, data]) => ({
      method,
      count: data.count,
      total_cents: data.total_cents,
    }))
  }, [payments])
}

// ---------------------------------------------------------------------------
// Grouped action hooks
// ---------------------------------------------------------------------------

export function useBillingAdminActions() {
  return useBillingAdminStore(
    useShallow((s) => ({
      fetchChecks: s.fetchChecks,
      fetchPayments: s.fetchPayments,
      upsertCheck: s.upsertCheck,
      upsertPayment: s.upsertPayment,
      setChecksFilter: s.setChecksFilter,
      setPaymentsFilter: s.setPaymentsFilter,
      reset: s.reset,
    })),
  )
}
