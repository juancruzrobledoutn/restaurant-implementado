/**
 * CheckStatusPage — /check (C-19 / Task 8.2).
 *
 * Displays the current check with:
 *   - CheckSummary (charges grid + totals)
 *   - PaymentButton (Pagar con MP)
 *   - PaymentStatus (phase feedback)
 *
 * Reactive to billingStore.status:
 *   - PAID → shows "Cuenta pagada" confirmation
 *   - REQUESTED → shows billing summary + payment CTA
 *
 * WS routing is handled by useBillingWS (mounted in App.tsx).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useSessionStore, selectToken, selectSessionId } from '../stores/sessionStore'
import { useBillingStore, selectCheckId, selectBillingStatus, selectIsCheckPaid } from '../stores/billingStore'
import { billingApi } from '../services/billingApi'
import { CheckSummary } from '../components/billing/CheckSummary'
import { PaymentButton } from '../components/billing/PaymentButton'
import { PaymentStatus } from '../components/billing/PaymentStatus'
import { logger } from '../utils/logger'

export default function CheckStatusPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const token = useSessionStore(selectToken)
  const sessionId = useSessionStore(selectSessionId)
  const checkId = useBillingStore(selectCheckId)
  const status = useBillingStore(selectBillingStatus)
  const isPaid = useBillingStore(selectIsCheckPaid)

  // True while we're attempting to hydrate the check from the API.
  // Prevents the "no check → redirect" guard from firing before hydration completes.
  const [hydrating, setHydrating] = useState(() => Boolean(sessionId && !checkId))

  // Hydrate check from API if we only have the ID but no status
  // Must be before early returns (Rules of Hooks)
  useEffect(() => {
    if (!sessionId || checkId) {
      setHydrating(false)
      return
    }

    async function hydrate() {
      try {
        const check = await billingApi.getCheck(sessionId!)
        if (check) {
          useBillingStore.getState().setCheck(check)
        }
      } catch (err) {
        logger.warn('CheckStatusPage: hydration failed', err)
      } finally {
        setHydrating(false)
      }
    }

    void hydrate()
  }, [sessionId, checkId])

  // Guards after all hooks
  if (!token || !sessionId) {
    navigate('/scan', { replace: true })
    return null
  }

  // Still fetching from backend — show spinner instead of redirecting prematurely
  if (hydrating) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!checkId && !status) {
    navigate('/check/request', { replace: true })
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col overflow-x-hidden w-full max-w-full">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 text-gray-600 hover:text-gray-800"
          aria-label={t('common.back')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-gray-800">{t('check.title')}</h1>
      </header>

      <main className="flex-1 flex flex-col gap-6 p-4">
        {isPaid ? (
          /* Paid confirmation */
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-800">{t('check.paid.title')}</h2>
            <p className="text-sm text-gray-600">{t('check.paid.message')}</p>
          </div>
        ) : (
          /* Active check */
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <CheckSummary />
            </div>

            {/* Payment status feedback */}
            <PaymentStatus />

            {/* Payment button — only show when check is REQUESTED and payment not in flight */}
            {status === 'REQUESTED' && (
              <div className="mt-auto">
                <PaymentButton />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
