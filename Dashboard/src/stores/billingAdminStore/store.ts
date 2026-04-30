/**
 * billingAdminStore — admin billing state (C-26).
 *
 * Skills: zustand-store-pattern
 *
 * State:
 *   - checks: paginated check list for current filter
 *   - payments: paginated payment list for current filter
 *   - Filters persisted in localStorage via persist() + partialize
 *
 * Design decisions (design.md D4, D9):
 *   - Modular folder structure (two sub-domains: checks + payments)
 *   - persist() ONLY persists checksFilter + paymentsFilter (not data)
 *   - Data is always refetched on mount
 *   - upsertCheck / upsertPayment driven by WS events (BillingRealtimeBridge)
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { STORAGE_KEYS, STORE_VERSIONS } from '@/utils/constants'
import { billingAdminAPI } from '@/services/billingAdminAPI'
import { handleError } from '@/utils/logger'

import type { BillingAdminState, ChecksFilter, PaymentsFilter } from './types'
import type { CheckSummary, PaymentSummary } from '@/types/billing'

// ---------------------------------------------------------------------------
// Stable empty references — never use inline ?? []
// ---------------------------------------------------------------------------

const EMPTY_CHECKS: CheckSummary[] = []
const EMPTY_PAYMENTS: PaymentSummary[] = []

// ---------------------------------------------------------------------------
// Default filter factories
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultChecksFilter(): ChecksFilter {
  return {
    date: todayISO(),
    status: null,
    page: 1,
    page_size: 20,
  }
}

function defaultPaymentsFilter(): PaymentsFilter {
  return {
    from: todayISO(),
    to: todayISO(),
    method: null,
    status: null,
    page: 1,
    page_size: 20,
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useBillingAdminStore = create<BillingAdminState>()(
  persist(
    (set, get) => ({
      // ── Checks ──────────────────────────────────────────────────────────
      checks: EMPTY_CHECKS,
      checksTotal: 0,
      checksIsLoading: false,
      checksError: null,
      checksFilter: defaultChecksFilter(),

      // ── Payments ────────────────────────────────────────────────────────
      payments: EMPTY_PAYMENTS,
      paymentsTotal: 0,
      paymentsIsLoading: false,
      paymentsError: null,
      paymentsFilter: defaultPaymentsFilter(),

      // ── Actions ─────────────────────────────────────────────────────────

      fetchChecks: async (branchId: string) => {
        set({ checksIsLoading: true, checksError: null })
        try {
          const result = await billingAdminAPI.listChecks(branchId, get().checksFilter)
          set({
            checks: result.items,
            checksTotal: result.total,
            checksIsLoading: false,
          })
        } catch (err) {
          set({
            checksIsLoading: false,
            checksError: handleError(err, 'billingAdminStore.fetchChecks'),
          })
        }
      },

      fetchPayments: async (branchId: string) => {
        set({ paymentsIsLoading: true, paymentsError: null })
        try {
          const result = await billingAdminAPI.listPayments(branchId, get().paymentsFilter)
          set({
            payments: result.items,
            paymentsTotal: result.total,
            paymentsIsLoading: false,
          })
        } catch (err) {
          set({
            paymentsIsLoading: false,
            paymentsError: handleError(err, 'billingAdminStore.fetchPayments'),
          })
        }
      },

      upsertCheck: (check: CheckSummary) => {
        set((state) => {
          const idx = state.checks.findIndex((c) => c.id === check.id)
          if (idx >= 0) {
            const next = [...state.checks]
            next[idx] = check
            return { checks: next }
          }
          return { checks: [check, ...state.checks] }
        })
      },

      upsertPayment: (payment: PaymentSummary) => {
        set((state) => {
          const idx = state.payments.findIndex((p) => p.id === payment.id)
          if (idx >= 0) {
            const next = [...state.payments]
            next[idx] = payment
            return { payments: next }
          }
          return { payments: [payment, ...state.payments] }
        })
      },

      setChecksFilter: (partial: Partial<ChecksFilter>) => {
        set((state) => ({
          checksFilter: { ...state.checksFilter, ...partial },
        }))
      },

      setPaymentsFilter: (partial: Partial<PaymentsFilter>) => {
        set((state) => ({
          paymentsFilter: { ...state.paymentsFilter, ...partial },
        }))
      },

      reset: () => {
        set({
          checks: EMPTY_CHECKS,
          checksTotal: 0,
          checksIsLoading: false,
          checksError: null,
          payments: EMPTY_PAYMENTS,
          paymentsTotal: 0,
          paymentsIsLoading: false,
          paymentsError: null,
        })
      },
    }),
    {
      name: STORAGE_KEYS.BILLING_ADMIN,
      version: STORE_VERSIONS.BILLING_ADMIN,
      // Only persist filters — data is always refetched on mount
      partialize: (state) => ({
        checksFilter: state.checksFilter,
        paymentsFilter: state.paymentsFilter,
      }),
      migrate: (persistedState: unknown, _version: number): Partial<BillingAdminState> => {
        if (!persistedState || typeof persistedState !== 'object') {
          return {
            checksFilter: defaultChecksFilter(),
            paymentsFilter: defaultPaymentsFilter(),
          }
        }
        const s = persistedState as {
          checksFilter?: ChecksFilter
          paymentsFilter?: PaymentsFilter
        }
        return {
          checksFilter: s.checksFilter ?? defaultChecksFilter(),
          paymentsFilter: s.paymentsFilter ?? defaultPaymentsFilter(),
        }
      },
    },
  ),
)

// Export stable empties for tests and selectors
export { EMPTY_CHECKS, EMPTY_PAYMENTS }
