/**
 * PaymentStatus — Renders conditional UI based on paymentStore phase (C-19 / Task 9.4).
 *
 * Phases:
 *   idle                — nothing shown
 *   creating_preference — spinner
 *   redirecting         — redirect message
 *   waiting             — spinner + "waiting for confirmation"
 *   approved            — success check icon
 *   rejected            — error icon + retry CTA
 *   failed              — error icon + retry CTA
 */
import { useTranslation } from 'react-i18next'
import { usePaymentStore, selectPaymentPhase, selectPaymentError } from '../../stores/paymentStore'

export function PaymentStatus() {
  const { t } = useTranslation()
  const phase = usePaymentStore(selectPaymentPhase)
  const error = usePaymentStore(selectPaymentError)

  if (phase === 'idle') return null

  return (
    <div className="w-full overflow-x-hidden" role="status" aria-live="polite">
      {(phase === 'creating_preference' || phase === 'waiting') && (
        <div className="flex flex-col items-center gap-3 py-6">
          <svg
            className="animate-spin h-8 w-8 text-orange-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-gray-600">
            {phase === 'waiting' ? t('payment.waiting') : t('payment.processing')}
          </p>
        </div>
      )}

      {phase === 'redirecting' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <p className="text-sm font-medium text-orange-600">{t('payment.redirecting')}</p>
        </div>
      )}

      {phase === 'approved' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-800">{t('payment.approved.title')}</h3>
          <p className="text-sm text-gray-600">{t('payment.approved.message')}</p>
        </div>
      )}

      {(phase === 'rejected' || phase === 'failed') && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-800">
            {phase === 'rejected' ? t('payment.rejected.title') : t('payment.failed.title')}
          </h3>
          <p className="text-sm text-gray-600">
            {error?.code === 'payment_mismatch'
              ? t('payment.failed.mismatch')
              : phase === 'rejected'
              ? t('payment.rejected.message')
              : t('payment.failed.message')}
          </p>
        </div>
      )}
    </div>
  )
}
