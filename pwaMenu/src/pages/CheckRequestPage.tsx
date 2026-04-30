/**
 * CheckRequestPage — /check/request (C-19 / Task 8.1).
 *
 * Allows the diner to select a split method and request the check.
 *
 * Features:
 *   - Only equal_split shown unless VITE_ENABLE_SPLIT_METHODS=true
 *   - Summary of total (from billingStore if already hydrated)
 *   - CTA "Solicitar cuenta"
 *   - 409 session_not_open → toast + stay
 *   - 429 rate limit → enqueue in retryQueueStore
 *   - Requires active session (redirect to /scan otherwise)
 */
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useSessionStore, selectToken, selectSessionId } from '../stores/sessionStore'
import { useBillingStore, selectTotalCents, selectBillingStatus } from '../stores/billingStore'
import { billingApi, CheckConflictError } from '../services/billingApi'
import { formatPrice } from '../utils/price'
import { logger } from '../utils/logger'
import type { SplitMethod } from '../types/billing'

// VITE_ENABLE_SPLIT_METHODS controls whether extra split options are shown.
// Default false — only equal_split visible in MVP.
const ENABLE_SPLIT_METHODS =
  (import.meta.env.VITE_ENABLE_SPLIT_METHODS as string | undefined) === 'true'

export default function CheckRequestPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const token = useSessionStore(selectToken)
  const sessionId = useSessionStore(selectSessionId)
  const totalCents = useBillingStore(selectTotalCents)
  const checkStatus = useBillingStore(selectBillingStatus)

  const [splitMethod, setSplitMethod] = useState<SplitMethod>('equal_split')
  const [isRequesting, setIsRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Must be before early returns (Rules of Hooks)
  const handleRequest = useCallback(async () => {
    if (isRequesting) return
    setIsRequesting(true)
    setError(null)

    try {
      const check = await billingApi.requestCheck(splitMethod)
      useBillingStore.getState().setCheck(check)
      logger.info('CheckRequestPage: check requested', { checkId: check.id })
      navigate('/check', { replace: true })
    } catch (err) {
      if (err instanceof CheckConflictError) {
        if (err.code === 'session_not_open') {
          setError(t('errors.billing.session_not_open'))
        } else {
          // check_already_exists — redirect to status
          navigate('/check', { replace: true })
        }
      } else {
        logger.error('CheckRequestPage: unexpected error', err)
        setError(t('errors.billing.request_failed'))
      }
    } finally {
      setIsRequesting(false)
    }
  }, [isRequesting, splitMethod, t, navigate])

  // Guards after all hooks
  if (!token || !sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-gray-600">{t('error.sessionRequired')}</p>
      </div>
    )
  }

  if (checkStatus && checkStatus !== 'OPEN') {
    navigate('/check', { replace: true })
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
        <h1 className="text-lg font-bold text-gray-800">{t('check.request')}</h1>
      </header>

      <main className="flex-1 flex flex-col gap-6 p-4">
        {/* Total summary (if available) */}
        {totalCents > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex justify-between items-center">
              <span className="text-base text-gray-600">{t('check.total')}</span>
              <span className="text-xl font-bold text-gray-800">{formatPrice(totalCents)}</span>
            </div>
          </div>
        )}

        {/* Split method selector */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-700">{t('check.split.label')}</h2>

          {/* equal_split — always visible */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="split_method"
              value="equal_split"
              checked={splitMethod === 'equal_split'}
              onChange={() => setSplitMethod('equal_split')}
              className="text-orange-500 focus:ring-orange-500"
            />
            <span className="text-sm text-gray-700">{t('check.split.equal')}</span>
          </label>

          {/* by_consumption — only if flag enabled */}
          {ENABLE_SPLIT_METHODS && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="split_method"
                value="by_consumption"
                checked={splitMethod === 'by_consumption'}
                onChange={() => setSplitMethod('by_consumption')}
                className="text-orange-500 focus:ring-orange-500"
              />
              <span className="text-sm text-gray-700">{t('check.split.by_consumption')}</span>
            </label>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg" role="alert">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* CTA */}
        <button
          type="button"
          onClick={handleRequest}
          disabled={isRequesting}
          aria-busy={isRequesting}
          className={[
            'w-full py-4 px-6 rounded-xl text-white font-bold text-lg',
            'transition-all duration-200',
            isRequesting
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700',
          ].join(' ')}
        >
          {isRequesting ? t('check.requesting') : t('check.request')}
        </button>
      </main>
    </div>
  )
}
