/**
 * Types for billingAdminStore (C-26).
 *
 * Skill: zustand-store-pattern
 */

import type {
  CheckSummary,
  PaymentSummary,
  ChecksFilter,
  PaymentsFilter,
} from '@/types/billing'

// Re-export filter types for convenience (avoids dual import in consumers)
export type { ChecksFilter, PaymentsFilter }

// ---------------------------------------------------------------------------
// Store state + actions
// ---------------------------------------------------------------------------

export interface BillingAdminState {
  // ── Checks ────────────────────────────────────────────────────────────────
  checks: CheckSummary[]
  checksTotal: number
  checksIsLoading: boolean
  checksError: string | null
  checksFilter: ChecksFilter

  // ── Payments ──────────────────────────────────────────────────────────────
  payments: PaymentSummary[]
  paymentsTotal: number
  paymentsIsLoading: boolean
  paymentsError: string | null
  paymentsFilter: PaymentsFilter

  // ── Actions ───────────────────────────────────────────────────────────────
  fetchChecks: (branchId: string) => Promise<void>
  fetchPayments: (branchId: string) => Promise<void>

  /** Upsert a check by id (insert if not exists, replace if exists). */
  upsertCheck: (check: CheckSummary) => void

  /** Upsert a payment by id (insert if not exists, replace if exists). */
  upsertPayment: (payment: PaymentSummary) => void

  setChecksFilter: (partial: Partial<ChecksFilter>) => void
  setPaymentsFilter: (partial: Partial<PaymentsFilter>) => void

  reset: () => void
}
