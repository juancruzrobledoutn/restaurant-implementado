/**
 * PaymentResultPage — /payment/result (C-19 / Task 8.3).
 *
 * [BLOQUEANTE — HUMAN REVIEW REQUIRED — CRITICO governance]
 *
 * Entry point after MercadoPago redirects back to pwaMenu.
 * Query params: payment_id, preference_id, status (from MP redirect)
 *
 * Flow:
 *   1. Read payment_id, preference_id, status from URL query params
 *   2. Validate preference_id matches paymentStore.preferenceId (mismatch → failed)
 *   3. Update paymentStore to 'waiting'
 *   4. Wait for WS PAYMENT_APPROVED / PAYMENT_REJECTED (up to 30s)
 *   5. If WS doesn't fire: polling GET /api/billing/payment/{id}/status
 *      → every 3s, 20 attempts = 60s total
 *   6. On result: update paymentStore → navigate to /check
 *
 * Security:
 *   - query params from MP are NOT trusted for final payment confirmation
 *   - status in URL is only used to fast-track UX (if 'rejected', go to failed immediately)
 *   - final confirmation always comes from WS or backend polling
 *
 * [HUMAN REVIEW — CRITICO: MP payment flow, fraud prevention]
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePaymentStore, selectPaymentPhase, selectPreferenceId } from '../stores/paymentStore'
import { billingApi } from '../services/billingApi'
import { logger } from '../utils/logger'

const POLLING_INTERVAL_MS = 3000
const POLLING_MAX_ATTEMPTS = 20
const WS_WAIT_MS = 30_000

export default function PaymentResultPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const paymentId = searchParams.get('payment_id')
  const preferenceId = searchParams.get('preference_id')
  const mpStatus = searchParams.get('status') // 'approved' | 'rejected' | 'pending'

  const phase = usePaymentStore(selectPaymentPhase)
  const storedPreferenceId = usePaymentStore(selectPreferenceId)
  const paymentTransition = usePaymentStore((s) => s.transition)
  const setPaymentId = usePaymentStore((s) => s.setPaymentId)
  const incrementPolling = usePaymentStore((s) => s.incrementPolling)

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resolvedRef = useRef(false)

  function clearTimers() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    if (wsTimerRef.current) {
      clearTimeout(wsTimerRef.current)
      wsTimerRef.current = null
    }
  }

  function resolvePayment(result: 'approved' | 'rejected' | 'failed', errorCode?: string) {
    if (resolvedRef.current) return
    resolvedRef.current = true
    clearTimers()

    if (result === 'approved') {
      paymentTransition('approved')
    } else if (result === 'rejected') {
      paymentTransition('rejected', { error: { code: errorCode ?? 'payment_rejected', message: 'Payment rejected' } })
    } else {
      paymentTransition('failed', { error: { code: errorCode ?? 'payment_failed', message: 'Payment failed' } })
    }

    // Navigate to check status page after a brief delay to show the result
    setTimeout(() => {
      navigate('/check', { replace: true })
    }, 2000)
  }

  useEffect(() => {
    // Step 1: Validate preference_id match (security check)
    if (storedPreferenceId && preferenceId && preferenceId !== storedPreferenceId) {
      logger.warn('PaymentResultPage: preference_id mismatch', {
        fromUrl: preferenceId,
        stored: storedPreferenceId,
      })
      paymentTransition('failed', { error: { code: 'payment_mismatch', message: 'Preference ID mismatch' } })
      return
    }

    // Step 2: Store payment_id if provided
    if (paymentId) {
      setPaymentId(paymentId)
    }

    // Step 3: Fast-track rejection (MP says rejected → no need to wait).
    // Use 'failed' when starting from idle (orphaned redirect after browser reload),
    // 'rejected' only when already in waiting state (normal payment flow).
    if (mpStatus === 'rejected' || mpStatus === 'failure') {
      const targetPhase = phase === 'waiting' ? 'rejected' : 'failed'
      paymentTransition(targetPhase, {
        error: { code: 'payment_rejected', message: 'Payment rejected by provider' },
      })
      return
    }

    // Step 4: Transition to 'waiting' — we're waiting for WS or polling
    if (phase !== 'waiting' && phase !== 'approved' && phase !== 'rejected') {
      paymentTransition('waiting')
    }

    // Step 5: WS wait window (30s) — if WS fires PAYMENT_APPROVED/REJECTED,
    // the phase will change and the phase-watch effect below handles navigation.
    wsTimerRef.current = setTimeout(() => {
      // WS didn't fire in time — start polling
      logger.info('PaymentResultPage: WS timeout, starting polling')
      startPolling()
    }, WS_WAIT_MS)

    return () => {
      clearTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Watch for WS-driven phase transitions
  useEffect(() => {
    if (phase === 'approved' || phase === 'rejected' || phase === 'failed') {
      if (!resolvedRef.current) {
        resolvedRef.current = true
        clearTimers()
        setTimeout(() => {
          navigate('/check', { replace: true })
        }, 2000)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function startPolling() {
    if (!paymentId) {
      logger.warn('PaymentResultPage: cannot poll — no payment_id')
      resolvePayment('failed', 'no_payment_id')
      return
    }

    let attempts = 0

    pollingRef.current = setInterval(async () => {
      if (resolvedRef.current) {
        clearTimers()
        return
      }

      attempts++
      incrementPolling()
      logger.debug('PaymentResultPage: polling attempt', { attempt: attempts, paymentId })

      try {
        const payment = await billingApi.getPaymentStatus(paymentId)

        if (payment?.status === 'approved') {
          resolvePayment('approved')
        } else if (payment?.status === 'rejected' || payment?.status === 'cancelled') {
          resolvePayment('rejected', 'payment_rejected')
        } else if (attempts >= POLLING_MAX_ATTEMPTS) {
          logger.warn('PaymentResultPage: polling exhausted', { attempts })
          resolvePayment('failed', 'polling_timeout')
        }
      } catch (err) {
        logger.error('PaymentResultPage: polling error', err)
        if (attempts >= POLLING_MAX_ATTEMPTS) {
          resolvePayment('failed', 'polling_error')
        }
      }
    }, POLLING_INTERVAL_MS)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 overflow-x-hidden w-full max-w-full">
      <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
        {phase === 'waiting' && (
          <>
            <svg
              className="animate-spin h-12 w-12 text-orange-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-base font-medium text-gray-700">{t('payment.waiting')}</p>
            <p className="text-sm text-gray-500">{t('payment.polling')}</p>
          </>
        )}

        {phase === 'approved' && (
          <>
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-800">{t('payment.approved.title')}</h1>
            <p className="text-sm text-gray-600">{t('payment.approved.message')}</p>
          </>
        )}

        {(phase === 'rejected' || phase === 'failed') && (
          <>
            <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-800">
              {phase === 'rejected' ? t('payment.rejected.title') : t('payment.failed.title')}
            </h1>
            <p className="text-sm text-gray-600">
              {phase === 'rejected' ? t('payment.rejected.message') : t('payment.failed.message')}
            </p>
            <button
              type="button"
              onClick={() => {
                paymentTransition('idle')
                navigate('/check', { replace: true })
              }}
              className="py-3 px-6 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold text-sm"
            >
              {t('payment.retry')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
