/**
 * BillingRealtimeBridge tests (C-26 — task 7.4).
 *
 * Coverage:
 * - mock dashboardWS.onFiltered; verify it is called with selectedBranchId
 * - when branchId changes → cleanup (unsubscribe) + resubscribe
 * - simulating CHECK_PAID event → upsertCheck is called
 * - simulating PAYMENT_APPROVED event → upsertPayment is called
 * - null branchId → no subscription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted to avoid hoisting issues with vi.mock factory
// ---------------------------------------------------------------------------

const { mockOnFiltered, mockUnsubscribe, mockUpsertCheck, mockUpsertPayment } = vi.hoisted(() => ({
  mockOnFiltered: vi.fn(),
  mockUnsubscribe: vi.fn(),
  mockUpsertCheck: vi.fn(),
  mockUpsertPayment: vi.fn(),
}))

let mockSelectedBranchId: string | null = '1'

vi.mock('@/services/websocket', () => ({
  dashboardWS: {
    onFiltered: mockOnFiltered,
  },
}))

vi.mock('@/stores/billingAdminStore', () => ({
  useBillingAdminStore: (selector: (s: unknown) => unknown) => {
    const state = {
      upsertCheck: mockUpsertCheck,
      upsertPayment: mockUpsertPayment,
    }
    return selector(state)
  },
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedBranchId: mockSelectedBranchId }),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
}))

// Static import after mocks
import { BillingRealtimeBridge } from './BillingRealtimeBridge'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockSelectedBranchId = '1'
  // Default: onFiltered returns a cleanup function
  mockOnFiltered.mockReturnValue(mockUnsubscribe)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BillingRealtimeBridge', () => {
  it('renders null (no DOM output)', () => {
    const { container } = render(<BillingRealtimeBridge />)
    expect(container.firstChild).toBeNull()
  })

  it('subscribes to dashboardWS.onFiltered with selectedBranchId on mount', () => {
    render(<BillingRealtimeBridge />)

    expect(mockOnFiltered).toHaveBeenCalledOnce()
    expect(mockOnFiltered).toHaveBeenCalledWith(
      '1',      // selectedBranchId
      '*',      // all event types
      expect.any(Function),
    )
  })

  it('does not subscribe when branchId is null', () => {
    mockSelectedBranchId = null

    render(<BillingRealtimeBridge />)

    expect(mockOnFiltered).not.toHaveBeenCalled()
  })

  it('calls unsubscribe on unmount', () => {
    const { unmount } = render(<BillingRealtimeBridge />)

    unmount()

    expect(mockUnsubscribe).toHaveBeenCalledOnce()
  })

  it('resubscribes when branchId changes (cleanup + new subscribe)', () => {
    mockSelectedBranchId = '1'
    const { rerender } = render(<BillingRealtimeBridge />)

    expect(mockOnFiltered).toHaveBeenCalledOnce()
    expect(mockOnFiltered).toHaveBeenLastCalledWith('1', '*', expect.any(Function))

    // Simulate branch change by updating the mock and re-rendering
    mockSelectedBranchId = '2'
    // Return a new unsubscribe for the second subscription
    const mockUnsubscribe2 = vi.fn()
    mockOnFiltered.mockReturnValue(mockUnsubscribe2)

    rerender(<BillingRealtimeBridge />)

    // Old unsubscribe should have been called (cleanup from effect deps change)
    expect(mockUnsubscribe).toHaveBeenCalledOnce()
    // New subscription with new branchId
    expect(mockOnFiltered).toHaveBeenCalledTimes(2)
    expect(mockOnFiltered).toHaveBeenLastCalledWith('2', '*', expect.any(Function))
  })

  it('calls upsertCheck when CHECK_PAID event is received', () => {
    render(<BillingRealtimeBridge />)

    // Extract the handler passed to onFiltered
    const handler = mockOnFiltered.mock.calls[0][2] as (event: unknown) => void

    act(() => {
      handler({
        type: 'CHECK_PAID',
        payload: {
          check_id: 42,
          session_id: 7,
          branch_id: 1,
          tenant_id: 1,
          total_cents: 5000,
          status: 'PAID',
        },
      })
    })

    expect(mockUpsertCheck).toHaveBeenCalledOnce()
    const check = mockUpsertCheck.mock.calls[0][0]
    expect(check.id).toBe('42')      // number → string conversion
    expect(check.status).toBe('PAID')
    expect(check.total_cents).toBe(5000)
    expect(mockUpsertPayment).not.toHaveBeenCalled()
  })

  it('calls upsertCheck when CHECK_REQUESTED event is received', () => {
    render(<BillingRealtimeBridge />)

    const handler = mockOnFiltered.mock.calls[0][2] as (event: unknown) => void

    act(() => {
      handler({
        type: 'CHECK_REQUESTED',
        payload: {
          check_id: 10,
          session_id: 3,
          branch_id: 1,
          tenant_id: 1,
          total_cents: 2000,
        },
      })
    })

    expect(mockUpsertCheck).toHaveBeenCalledOnce()
    const check = mockUpsertCheck.mock.calls[0][0]
    expect(check.id).toBe('10')
    expect(check.status).toBe('REQUESTED')  // default status for CHECK_REQUESTED
  })

  it('calls upsertPayment when PAYMENT_APPROVED event is received', () => {
    render(<BillingRealtimeBridge />)

    const handler = mockOnFiltered.mock.calls[0][2] as (event: unknown) => void

    act(() => {
      handler({
        type: 'PAYMENT_APPROVED',
        payload: {
          payment_id: 99,
          check_id: 42,
          amount_cents: 5000,
          method: 'card',
          branch_id: 1,
          tenant_id: 1,
        },
      })
    })

    expect(mockUpsertPayment).toHaveBeenCalledOnce()
    const payment = mockUpsertPayment.mock.calls[0][0]
    expect(payment.id).toBe('99')
    expect(payment.check_id).toBe('42')
    expect(payment.status).toBe('APPROVED')
    expect(payment.method).toBe('card')
    expect(mockUpsertCheck).not.toHaveBeenCalled()
  })

  it('calls upsertPayment when PAYMENT_REJECTED event is received', () => {
    render(<BillingRealtimeBridge />)

    const handler = mockOnFiltered.mock.calls[0][2] as (event: unknown) => void

    act(() => {
      handler({
        type: 'PAYMENT_REJECTED',
        payload: {
          payment_id: 100,
          check_id: 42,
          amount_cents: 5000,
          method: 'mercadopago',
          branch_id: 1,
          tenant_id: 1,
        },
      })
    })

    expect(mockUpsertPayment).toHaveBeenCalledOnce()
    const payment = mockUpsertPayment.mock.calls[0][0]
    expect(payment.status).toBe('REJECTED')
  })

  it('ignores unrelated event types', () => {
    render(<BillingRealtimeBridge />)

    const handler = mockOnFiltered.mock.calls[0][2] as (event: unknown) => void

    act(() => {
      handler({ type: 'TABLE_SESSION_STARTED', payload: {} })
    })

    expect(mockUpsertCheck).not.toHaveBeenCalled()
    expect(mockUpsertPayment).not.toHaveBeenCalled()
  })
})
