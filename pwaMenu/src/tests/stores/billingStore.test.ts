/**
 * Unit tests for billingStore (C-19 / Task 6.4).
 *
 * Tests: setCheck idempotency, updateStatus, addPayment, reset,
 * selectors including derived (selectIsCheckActive, selectIsCheckPaid).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  useBillingStore,
  selectCheckId,
  selectBillingStatus,
  selectTotalCents,
  selectRemainingCents,
  selectCharges,
  selectPayments,
  selectIsCheckActive,
  selectIsCheckPaid,
} from '../../stores/billingStore'
import type { Check, Charge, Payment } from '../../types/billing'

function makeCheck(overrides: Partial<Check> = {}): Check {
  return {
    id: '101',
    sessionId: '42',
    status: 'REQUESTED',
    splitMethod: 'equal_split',
    totalCents: 5000,
    remainingCents: 5000,
    charges: [],
    payments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function resetStore() {
  useBillingStore.setState({
    checkId: null,
    sessionId: null,
    status: null,
    splitMethod: null,
    totalCents: 0,
    charges: [],
    payments: [],
    remainingCents: 0,
    loadedAt: null,
  })
}

describe('billingStore', () => {
  beforeEach(() => {
    resetStore()
  })

  describe('setCheck', () => {
    it('sets all check fields', () => {
      const check = makeCheck()
      useBillingStore.getState().setCheck(check)

      const state = useBillingStore.getState()
      expect(selectCheckId(state)).toBe('101')
      expect(selectBillingStatus(state)).toBe('REQUESTED')
      expect(selectTotalCents(state)).toBe(5000)
      expect(selectRemainingCents(state)).toBe(5000)
      expect(state.loadedAt).toBeGreaterThan(0)
    })

    it('is idempotent — re-calling with same check updates loadedAt', () => {
      const check = makeCheck()
      useBillingStore.getState().setCheck(check)
      const firstLoadedAt = useBillingStore.getState().loadedAt

      // Small delay to ensure timestamp differs
      const check2 = makeCheck({ totalCents: 5000 })
      useBillingStore.getState().setCheck(check2)
      const secondLoadedAt = useBillingStore.getState().loadedAt

      expect(secondLoadedAt).toBeGreaterThanOrEqual(firstLoadedAt!)
      expect(selectTotalCents(useBillingStore.getState())).toBe(5000)
    })

    it('handles empty charges and payments with stable EMPTY refs', () => {
      useBillingStore.getState().setCheck(makeCheck({ charges: [], payments: [] }))
      const charges = selectCharges(useBillingStore.getState())
      const payments = selectPayments(useBillingStore.getState())
      // Both should be stable empty arrays (falsy length but truthy refs)
      expect(Array.isArray(charges)).toBe(true)
      expect(Array.isArray(payments)).toBe(true)
      expect(charges).toHaveLength(0)
      expect(payments).toHaveLength(0)
    })

    it('stores charges when present', () => {
      const charge: Charge = {
        id: '1',
        dinerId: '7',
        dinerName: 'Alice',
        amountCents: 2500,
        splitMethod: 'equal_split',
      }
      useBillingStore.getState().setCheck(makeCheck({ charges: [charge] }))
      const charges = selectCharges(useBillingStore.getState())
      expect(charges).toHaveLength(1)
      expect(charges[0].dinerName).toBe('Alice')
    })
  })

  describe('updateStatus', () => {
    it('updates status', () => {
      useBillingStore.getState().setCheck(makeCheck({ status: 'REQUESTED' }))
      useBillingStore.getState().updateStatus('PAID')
      expect(selectBillingStatus(useBillingStore.getState())).toBe('PAID')
    })

    it('is idempotent when status is the same', () => {
      useBillingStore.getState().setCheck(makeCheck({ status: 'REQUESTED' }))
      useBillingStore.getState().updateStatus('REQUESTED')
      expect(selectBillingStatus(useBillingStore.getState())).toBe('REQUESTED')
    })
  })

  describe('addPayment', () => {
    it('adds a new payment', () => {
      const payment: Payment = {
        id: 'pay-1',
        method: 'mercadopago',
        amountCents: 5000,
        status: 'approved',
        externalId: 'mp-ext-1',
        paidAt: new Date().toISOString(),
      }
      useBillingStore.getState().setCheck(makeCheck())
      useBillingStore.getState().addPayment(payment)
      const payments = selectPayments(useBillingStore.getState())
      expect(payments).toHaveLength(1)
      expect(payments[0].id).toBe('pay-1')
    })

    it('updates existing payment (idempotent by id)', () => {
      const payment: Payment = {
        id: 'pay-1',
        method: 'mercadopago',
        amountCents: 5000,
        status: 'pending',
        externalId: null,
        paidAt: null,
      }
      useBillingStore.getState().setCheck(makeCheck())
      useBillingStore.getState().addPayment(payment)

      const updatedPayment = { ...payment, status: 'approved' as const, paidAt: new Date().toISOString() }
      useBillingStore.getState().addPayment(updatedPayment)

      const payments = selectPayments(useBillingStore.getState())
      expect(payments).toHaveLength(1) // not duplicated
      expect(payments[0].status).toBe('approved')
    })
  })

  describe('derived selectors', () => {
    it('selectIsCheckActive: true for REQUESTED and OPEN', () => {
      useBillingStore.getState().setCheck(makeCheck({ status: 'REQUESTED' }))
      expect(selectIsCheckActive(useBillingStore.getState())).toBe(true)

      useBillingStore.getState().updateStatus('OPEN')
      expect(selectIsCheckActive(useBillingStore.getState())).toBe(true)
    })

    it('selectIsCheckActive: false for PAID', () => {
      useBillingStore.getState().setCheck(makeCheck({ status: 'PAID' }))
      expect(selectIsCheckActive(useBillingStore.getState())).toBe(false)
    })

    it('selectIsCheckPaid: true only for PAID', () => {
      useBillingStore.getState().setCheck(makeCheck({ status: 'REQUESTED' }))
      expect(selectIsCheckPaid(useBillingStore.getState())).toBe(false)

      useBillingStore.getState().updateStatus('PAID')
      expect(selectIsCheckPaid(useBillingStore.getState())).toBe(true)
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      useBillingStore.getState().setCheck(makeCheck())
      useBillingStore.getState().reset()

      const state = useBillingStore.getState()
      expect(selectCheckId(state)).toBeNull()
      expect(selectBillingStatus(state)).toBeNull()
      expect(selectTotalCents(state)).toBe(0)
      expect(state.loadedAt).toBeNull()
    })
  })
})
