/**
 * PaymentButton — MercadoPago payment CTA button (C-19 / Task 9.3).
 *
 * Orange (#f97316 = text-orange-500, bg-orange-500) per design system.
 * Disabled when phase === 'creating_preference' to prevent double-submit.
 * onClick calls mercadoPago.createPreferenceAndRedirect(checkId).
 *
 * [HUMAN REVIEW — CRITICO: this button triggers the MP redirect flow]
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useBillingStore, selectCheckId } from '../../stores/billingStore'
import { usePaymentStore, selectIsCreatingPreference } from '../../stores/paymentStore'
import { createPreferenceAndRedirect, PreferenceCreationError } from '../../services/mercadoPago'
import { logger } from '../../utils/logger'

export function PaymentButton() {
  const { t } = useTranslation()

  const checkId = useBillingStore(selectCheckId)
  const isCreating = usePaymentStore(selectIsCreatingPreference)
  const paymentTransition = usePaymentStore((s) => s.transition)

  const isDisabled = isCreating || !checkId

  const handlePay = useCallback(async () => {
    if (!checkId) return

    paymentTransition('creating_preference')

    try {
      const result = await createPreferenceAndRedirect(checkId)
      paymentTransition('redirecting', { preferenceId: result.preferenceId })
    } catch (err) {
      if (err instanceof PreferenceCreationError) {
        paymentTransition('failed', {
          error: { code: err.code, message: err.message },
        })
        logger.warn('PaymentButton: preference creation failed', { code: err.code })
      } else {
        paymentTransition('failed', {
          error: { code: 'preference_error', message: String(err) },
        })
        logger.error('PaymentButton: unexpected error', err)
      }
    }
  }, [checkId, paymentTransition])

  return (
    <button
      type="button"
      onClick={handlePay}
      disabled={isDisabled}
      aria-busy={isCreating}
      className={[
        'w-full py-4 px-6 rounded-xl text-white font-bold text-lg',
        'transition-all duration-200',
        isDisabled
          ? 'bg-gray-300 cursor-not-allowed'
          : 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700',
      ].join(' ')}
    >
      {isCreating ? (
        <span className="flex items-center justify-center gap-2">
          <svg
            className="animate-spin h-5 w-5 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          {t('payment.processing')}
        </span>
      ) : (
        t('payment.cta')
      )}
    </button>
  )
}
