/**
 * Unit tests for paymentStore (C-19 / Task 6.5).
 *
 * Tests:
 *   - Valid transitions succeed
 *   - Invalid transitions log WARN and do NOT mutate state
 *   - reset() clears all fields
 *   - incrementPolling() increments counter
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  usePaymentStore,
  selectPaymentPhase,
  selectPreferenceId,
  selectPaymentId,
  selectPaymentError,
  selectPollingAttempts,
} from '../../stores/paymentStore'

// vi.mock is hoisted above regular const declarations, so we must use vi.hoisted()
// to declare the mock reference — otherwise mockLogger is uninitialized when the
// factory runs and we get "Cannot access 'mockLogger' before initialization".
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../utils/logger', () => ({
  logger: mockLogger,
}))

function resetStore() {
  usePaymentStore.getState().reset()
}

describe('paymentStore FSM', () => {
  beforeEach(() => {
    resetStore()
  })

  describe('valid transitions', () => {
    it('idle → creating_preference', () => {
      usePaymentStore.getState().transition('creating_preference')
      expect(selectPaymentPhase(usePaymentStore.getState())).toBe('creating_preference')
    })

    it('creating_preference → redirecting', () => {
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().transition('redirecting', { preferenceId: 'pref-123' })
      const state = usePaymentStore.getState()
      expect(selectPaymentPhase(state)).toBe('redirecting')
      expect(selectPreferenceId(state)).toBe('pref-123')
    })

    it('redirecting → waiting', () => {
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().transition('redirecting')
      usePaymentStore.getState().transition('waiting')
      expect(selectPaymentPhase(usePaymentStore.getState())).toBe('waiting')
    })

    it('waiting → approved', () => {
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().transition('redirecting')
      usePaymentStore.getState().transition('waiting')
      usePaymentStore.getState().transition('approved', { paymentId: 'pay-999' })
      const state = usePaymentStore.getState()
      expect(selectPaymentPhase(state)).toBe('approved')
      expect(selectPaymentId(state)).toBe('pay-999')
    })

    it('waiting → rejected', () => {
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().transition('redirecting')
      usePaymentStore.getState().transition('waiting')
      usePaymentStore.getState().transition('rejected', {
        error: { code: 'payment_rejected', message: 'Rejected' },
      })
      const state = usePaymentStore.getState()
      expect(selectPaymentPhase(state)).toBe('rejected')
      expect(selectPaymentError(state)?.code).toBe('payment_rejected')
    })

    it('waiting → failed', () => {
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().transition('redirecting')
      usePaymentStore.getState().transition('waiting')
      usePaymentStore.getState().transition('failed', {
        error: { code: 'timeout', message: 'Timed out' },
      })
      expect(selectPaymentPhase(usePaymentStore.getState())).toBe('failed')
    })

    it('rejected → creating_preference (retry)', () => {
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().transition('redirecting')
      usePaymentStore.getState().transition('waiting')
      usePaymentStore.getState().transition('rejected')
      usePaymentStore.getState().transition('creating_preference')
      expect(selectPaymentPhase(usePaymentStore.getState())).toBe('creating_preference')
    })

    it('creating_preference → failed (API error)', () => {
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().transition('failed', {
        error: { code: 'api_error', message: 'Network error' },
      })
      expect(selectPaymentPhase(usePaymentStore.getState())).toBe('failed')
    })
  })

  describe('invalid transitions — do NOT mutate state', () => {
    it('idle → waiting is invalid', () => {
      usePaymentStore.getState().transition('waiting')
      expect(selectPaymentPhase(usePaymentStore.getState())).toBe('idle') // unchanged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('INVALID'),
        expect.any(Object),
      )
    })

    it('approved → creating_preference is invalid', () => {
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().transition('redirecting')
      usePaymentStore.getState().transition('waiting')
      usePaymentStore.getState().transition('approved')
      // approved → creating_preference is NOT in the valid map
      usePaymentStore.getState().transition('creating_preference')
      expect(selectPaymentPhase(usePaymentStore.getState())).toBe('approved') // unchanged
    })
  })

  describe('reset from any state', () => {
    it('reset is always allowed', () => {
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().transition('idle') // reset via transition to idle
      expect(selectPaymentPhase(usePaymentStore.getState())).toBe('idle')
    })

    it('reset() clears all fields', () => {
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().setPreferenceId('pref-abc')
      usePaymentStore.getState().setPaymentId('pay-xyz')

      usePaymentStore.getState().reset()

      const state = usePaymentStore.getState()
      expect(selectPaymentPhase(state)).toBe('idle')
      expect(selectPreferenceId(state)).toBeNull()
      expect(selectPaymentId(state)).toBeNull()
      expect(selectPaymentError(state)).toBeNull()
      expect(selectPollingAttempts(state)).toBe(0)
    })
  })

  describe('startedAt tracking', () => {
    it('sets startedAt when transitioning from idle to creating_preference', () => {
      const before = Date.now()
      usePaymentStore.getState().transition('creating_preference')
      const state = usePaymentStore.getState()
      expect(state.startedAt).toBeGreaterThanOrEqual(before)
    })

    it('resets pollingAttempts on new flow', () => {
      // Complete a flow
      usePaymentStore.getState().transition('creating_preference')
      usePaymentStore.getState().incrementPolling()
      usePaymentStore.getState().incrementPolling()
      expect(selectPollingAttempts(usePaymentStore.getState())).toBe(2)

      // Reset and start new flow
      usePaymentStore.getState().transition('idle')
      usePaymentStore.getState().transition('creating_preference')
      expect(selectPollingAttempts(usePaymentStore.getState())).toBe(0)
    })
  })

  describe('incrementPolling', () => {
    it('increments counter', () => {
      usePaymentStore.getState().incrementPolling()
      usePaymentStore.getState().incrementPolling()
      usePaymentStore.getState().incrementPolling()
      expect(selectPollingAttempts(usePaymentStore.getState())).toBe(3)
    })
  })
})
