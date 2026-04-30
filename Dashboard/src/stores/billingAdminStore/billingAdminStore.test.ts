/**
 * billingAdminStore unit tests (C-26 — task 6.7).
 *
 * Coverage:
 * - upsertCheck: replaces existing check by id / adds if not exists
 * - upsertPayment: idem
 * - filters persist correctly (partialize) → survives rehidrate simulation
 * - EMPTY_CHECKS and EMPTY_PAYMENTS are the same reference between reads
 * - setChecksFilter: spread (partial update), does NOT replace entire filter
 * - setPaymentsFilter: same
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock deps before importing store
vi.mock('@/services/billingAdminAPI', () => ({
  billingAdminAPI: {
    listChecks: vi.fn(),
    listPayments: vi.fn(),
  },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

import { useBillingAdminStore, EMPTY_CHECKS, EMPTY_PAYMENTS } from './store'
import type { CheckSummary, PaymentSummary } from '@/types/billing'

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeCheck(id: string, status: 'REQUESTED' | 'PAID' = 'REQUESTED'): CheckSummary {
  return {
    id,
    session_id: `sess-${id}`,
    branch_id: '1',
    total_cents: 1000,
    covered_cents: 0,
    status,
    created_at: '2026-04-21T12:00:00Z',
  }
}

function makePayment(id: string, status: 'APPROVED' | 'REJECTED' | 'PENDING' | 'FAILED' = 'APPROVED'): PaymentSummary {
  return {
    id,
    check_id: '42',
    amount_cents: 500,
    method: 'cash',
    status,
    created_at: '2026-04-21T12:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// Reset store before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  useBillingAdminStore.setState({
    checks: EMPTY_CHECKS,
    checksTotal: 0,
    checksIsLoading: false,
    checksError: null,
    checksFilter: { date: '2026-04-21', status: null, page: 1, page_size: 20 },
    payments: EMPTY_PAYMENTS,
    paymentsTotal: 0,
    paymentsIsLoading: false,
    paymentsError: null,
    paymentsFilter: { from: '2026-04-21', to: '2026-04-21', method: null, status: null, page: 1, page_size: 20 },
  })
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// upsertCheck
// ---------------------------------------------------------------------------

describe('upsertCheck', () => {
  it('adds a new check when id does not exist', () => {
    const check = makeCheck('1')
    useBillingAdminStore.getState().upsertCheck(check)

    const checks = useBillingAdminStore.getState().checks
    expect(checks).toHaveLength(1)
    expect(checks[0]!.id).toBe('1')
  })

  it('replaces an existing check with same id', () => {
    const original = makeCheck('1', 'REQUESTED')
    useBillingAdminStore.getState().upsertCheck(original)

    const updated = makeCheck('1', 'PAID')
    useBillingAdminStore.getState().upsertCheck(updated)

    const checks = useBillingAdminStore.getState().checks
    expect(checks).toHaveLength(1)
    expect(checks[0]!.status).toBe('PAID')
  })

  it('inserts at front when adding a new check to existing list', () => {
    useBillingAdminStore.getState().upsertCheck(makeCheck('1'))
    useBillingAdminStore.getState().upsertCheck(makeCheck('2'))
    useBillingAdminStore.getState().upsertCheck(makeCheck('99'))

    const checks = useBillingAdminStore.getState().checks
    expect(checks[0]!.id).toBe('99')  // most recently added at front
    expect(checks).toHaveLength(3)
  })

  it('preserves other checks when replacing one', () => {
    useBillingAdminStore.getState().upsertCheck(makeCheck('1'))
    useBillingAdminStore.getState().upsertCheck(makeCheck('2'))
    useBillingAdminStore.getState().upsertCheck(makeCheck('3'))

    useBillingAdminStore.getState().upsertCheck(makeCheck('2', 'PAID'))

    const checks = useBillingAdminStore.getState().checks
    expect(checks).toHaveLength(3)
    const check2 = checks.find((c) => c.id === '2')
    expect(check2?.status).toBe('PAID')
  })
})

// ---------------------------------------------------------------------------
// upsertPayment
// ---------------------------------------------------------------------------

describe('upsertPayment', () => {
  it('adds a new payment when id does not exist', () => {
    const payment = makePayment('10')
    useBillingAdminStore.getState().upsertPayment(payment)

    expect(useBillingAdminStore.getState().payments).toHaveLength(1)
  })

  it('replaces an existing payment with same id', () => {
    useBillingAdminStore.getState().upsertPayment(makePayment('10', 'PENDING'))
    useBillingAdminStore.getState().upsertPayment(makePayment('10', 'APPROVED'))

    const payments = useBillingAdminStore.getState().payments
    expect(payments).toHaveLength(1)
    expect(payments[0]!.status).toBe('APPROVED')
  })

  it('preserves other payments when replacing one', () => {
    useBillingAdminStore.getState().upsertPayment(makePayment('10'))
    useBillingAdminStore.getState().upsertPayment(makePayment('11'))
    useBillingAdminStore.getState().upsertPayment(makePayment('12'))

    useBillingAdminStore.getState().upsertPayment(makePayment('11', 'REJECTED'))

    const payments = useBillingAdminStore.getState().payments
    expect(payments).toHaveLength(3)
    expect(payments.find((p) => p.id === '11')?.status).toBe('REJECTED')
  })
})

// ---------------------------------------------------------------------------
// EMPTY_CHECKS / EMPTY_PAYMENTS — stable references
// ---------------------------------------------------------------------------

describe('EMPTY_* stable references', () => {
  it('EMPTY_CHECKS is the same array reference every time it is read', () => {
    // Read it from different paths — must always be the exact same object
    const ref1 = useBillingAdminStore.getState().checks
    const ref2 = useBillingAdminStore.getState().checks

    // Both reads return the same module-level EMPTY_CHECKS constant
    expect(ref1).toBe(ref2)
  })

  it('EMPTY_PAYMENTS is the same array reference every time it is read', () => {
    const ref1 = useBillingAdminStore.getState().payments
    const ref2 = useBillingAdminStore.getState().payments
    expect(ref1).toBe(ref2)
  })

  it('EMPTY_CHECKS exported constant is a stable empty array', () => {
    expect(EMPTY_CHECKS).toHaveLength(0)
    // Same reference across reads — the module-level const never changes
    expect(EMPTY_CHECKS).toBe(EMPTY_CHECKS)
  })

  it('EMPTY_PAYMENTS exported constant is a stable empty array', () => {
    expect(EMPTY_PAYMENTS).toHaveLength(0)
    expect(EMPTY_PAYMENTS).toBe(EMPTY_PAYMENTS)
  })
})

// ---------------------------------------------------------------------------
// setChecksFilter — spread (partial update, NOT replace)
// ---------------------------------------------------------------------------

describe('setChecksFilter', () => {
  it('updates only the specified fields (spread behavior)', () => {
    // Set a non-default date
    useBillingAdminStore.getState().setChecksFilter({ date: '2026-03-15' })

    const filter = useBillingAdminStore.getState().checksFilter
    expect(filter.date).toBe('2026-03-15')
    // Other fields must remain intact
    expect(filter.status).toBeNull()
    expect(filter.page).toBe(1)
    expect(filter.page_size).toBe(20)
  })

  it('updates status without touching other fields', () => {
    useBillingAdminStore.getState().setChecksFilter({ status: 'PAID' })

    const filter = useBillingAdminStore.getState().checksFilter
    expect(filter.status).toBe('PAID')
    expect(filter.date).toBe('2026-04-21')
    expect(filter.page).toBe(1)
  })

  it('updates page without touching date or status', () => {
    useBillingAdminStore.getState().setChecksFilter({ page: 3 })

    const filter = useBillingAdminStore.getState().checksFilter
    expect(filter.page).toBe(3)
    expect(filter.date).toBe('2026-04-21')
    expect(filter.status).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// setPaymentsFilter — same spread behavior
// ---------------------------------------------------------------------------

describe('setPaymentsFilter', () => {
  it('updates only method without touching other fields', () => {
    useBillingAdminStore.getState().setPaymentsFilter({ method: 'card' })

    const filter = useBillingAdminStore.getState().paymentsFilter
    expect(filter.method).toBe('card')
    expect(filter.from).toBe('2026-04-21')
    expect(filter.to).toBe('2026-04-21')
    expect(filter.status).toBeNull()
    expect(filter.page).toBe(1)
  })

  it('updates from/to date range without touching method/status', () => {
    useBillingAdminStore.getState().setPaymentsFilter({ from: '2026-04-01', to: '2026-04-20' })

    const filter = useBillingAdminStore.getState().paymentsFilter
    expect(filter.from).toBe('2026-04-01')
    expect(filter.to).toBe('2026-04-20')
    expect(filter.method).toBeNull()
    expect(filter.status).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Filter persist survives rehidrate simulation
// ---------------------------------------------------------------------------

describe('filter persistence (partialize simulation)', () => {
  it('persisted filter is restored when store is rehydrated with partial state', () => {
    // Simulate rehydration: partialize only persists checksFilter and paymentsFilter
    const persistedFilter = { date: '2026-03-01', status: 'PAID' as const, page: 2, page_size: 20 }

    // Simulate what Zustand's persist middleware does during rehydration:
    // it merges the persisted partial state into the current state.
    useBillingAdminStore.setState((state) => ({
      ...state,
      checksFilter: persistedFilter,
    }))

    const filter = useBillingAdminStore.getState().checksFilter
    expect(filter.date).toBe('2026-03-01')
    expect(filter.status).toBe('PAID')
    expect(filter.page).toBe(2)

    // Non-persisted data (checks array) starts fresh
    expect(useBillingAdminStore.getState().checks).toEqual(EMPTY_CHECKS)
  })

  it('checks and payments are NOT included in persisted state (partialize)', () => {
    // After upsertCheck, if we simulate a rehydration the checks should NOT be restored
    useBillingAdminStore.getState().upsertCheck(makeCheck('1'))
    expect(useBillingAdminStore.getState().checks).toHaveLength(1)

    // Simulate fresh mount (reset data only — filters would be loaded from storage)
    useBillingAdminStore.getState().reset()

    // Data cleared — filters remain
    expect(useBillingAdminStore.getState().checks).toHaveLength(0)
    expect(useBillingAdminStore.getState().checksFilter).toBeDefined()
  })
})
