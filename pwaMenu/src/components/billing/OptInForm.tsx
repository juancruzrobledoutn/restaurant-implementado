/**
 * OptInForm — GDPR opt-in form using React 19 useActionState (C-19 / Task 9.6).
 *
 * Follows react19-form-pattern skill strictly:
 * - form uses action={formAction} — NOT onSubmit
 * - isPending from useActionState for loading state
 * - Modal close via state.isSuccess, NOT inside action
 * - Validation returns early with { errors, isSuccess: false }
 *
 * [HUMAN REVIEW REQUIRED — CRITICO: stores PII (name, email)]
 */
import { useActionState, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { customerApi, AlreadyOptedInError, ConsentRequiredError } from '../../services/customerApi'
import { useCustomerStore } from '../../stores/customerStore'
import { ConsentBlock } from './ConsentBlock'
import { logger } from '../../utils/logger'

// --- Form state type ---
interface OptInFormState {
  isSuccess: boolean
  errors?: {
    name?: string
    email?: string
    consent?: string
    _global?: string
  }
  message?: string
}

interface OptInFormProps {
  /** Called when opt-in succeeds (e.g. navigate to profile) */
  onSuccess?: () => void
}

function validateOptIn(name: string, email: string, consentGranted: boolean): OptInFormState | null {
  const errors: OptInFormState['errors'] = {}

  if (!name.trim() || name.trim().length < 2) {
    errors.name = 'customer.optin.errors.nameRequired'
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!email.trim() || !emailRegex.test(email.trim().toLowerCase())) {
    errors.email = 'customer.optin.errors.emailInvalid'
  }

  if (!consentGranted) {
    errors.consent = 'customer.optin.errors.consentRequired'
  }

  if (Object.keys(errors).length > 0) {
    return { isSuccess: false, errors }
  }

  return null
}

export function OptInForm({ onSuccess }: OptInFormProps) {
  const { t } = useTranslation()
  const setProfile = useCustomerStore((s) => s.setProfile)

  // Local state for consent checkbox (GDPR art. 7 — must NOT be pre-checked)
  const [consentChecked, setConsentChecked] = useState(false)

  const submitAction = useCallback(
    async (_prevState: OptInFormState, formData: FormData): Promise<OptInFormState> => {
      const name = formData.get('name') as string
      const email = formData.get('email') as string
      const consentGranted = formData.get('consent_granted') === 'on'

      // Validate — return early on errors
      const validationError = validateOptIn(name, email, consentGranted)
      if (validationError) return validationError

      try {
        const profile = await customerApi.optIn({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          consent_version: 'v1', // from i18n consent.version
          consent_granted: true,
        })

        // Update customer store with the new opted-in profile
        setProfile(profile)
        logger.info('OptInForm: opt-in successful')

        return { isSuccess: true, message: 'customer.optin.success' }
      } catch (err) {
        if (err instanceof AlreadyOptedInError) {
          return { isSuccess: false, errors: { _global: 'customer.optin.alreadyOptedIn' } }
        }
        if (err instanceof ConsentRequiredError) {
          return { isSuccess: false, errors: { consent: 'customer.optin.errors.consentRequired' } }
        }
        logger.error('OptInForm: opt-in failed', err)
        return { isSuccess: false, errors: { _global: 'error.unknown' } }
      }
    },
    [setProfile],
  )

  const [state, formAction, isPending] = useActionState<OptInFormState, FormData>(
    submitAction,
    { isSuccess: false },
  )

  // Close / navigate on success (outside the action function — react19-form-pattern)
  if (state.isSuccess) {
    onSuccess?.()
  }

  return (
    <form id="optin-form" action={formAction} className="flex flex-col gap-4 overflow-x-hidden w-full max-w-full">
      {/* Global error */}
      {state.errors?._global && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg" role="alert">
          <p className="text-sm text-red-700">{t(state.errors._global)}</p>
        </div>
      )}

      {/* Name field */}
      <div className="flex flex-col gap-1">
        <label htmlFor="optin-name" className="text-sm font-medium text-gray-700">
          {t('customer.optin.name')} <span className="text-red-500">*</span>
        </label>
        <input
          id="optin-name"
          name="name"
          type="text"
          autoComplete="given-name"
          placeholder={t('customer.optin.namePlaceholder')}
          className={[
            'w-full rounded-lg border px-3 py-2 text-sm text-gray-800',
            'focus:outline-none focus:ring-2 focus:ring-orange-500',
            state.errors?.name ? 'border-red-400' : 'border-gray-300',
          ].join(' ')}
          aria-invalid={!!state.errors?.name}
          aria-describedby={state.errors?.name ? 'optin-name-error' : undefined}
          disabled={isPending}
        />
        {state.errors?.name && (
          <p id="optin-name-error" className="text-xs text-red-600" role="alert">
            {t(state.errors.name)}
          </p>
        )}
      </div>

      {/* Email field */}
      <div className="flex flex-col gap-1">
        <label htmlFor="optin-email" className="text-sm font-medium text-gray-700">
          {t('customer.optin.email')} <span className="text-red-500">*</span>
        </label>
        <input
          id="optin-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('customer.optin.emailPlaceholder')}
          className={[
            'w-full rounded-lg border px-3 py-2 text-sm text-gray-800',
            'focus:outline-none focus:ring-2 focus:ring-orange-500',
            state.errors?.email ? 'border-red-400' : 'border-gray-300',
          ].join(' ')}
          aria-invalid={!!state.errors?.email}
          aria-describedby={state.errors?.email ? 'optin-email-error' : undefined}
          disabled={isPending}
        />
        {state.errors?.email && (
          <p id="optin-email-error" className="text-xs text-red-600" role="alert">
            {t(state.errors.email)}
          </p>
        )}
      </div>

      {/* Consent block — NOT pre-checked (GDPR art. 7 requires active consent) */}
      {/* consentChecked is local state so the checkbox is actually checkable */}
      <ConsentBlock
        checked={consentChecked}
        onChange={setConsentChecked}
        error={state.errors?.consent ? t(state.errors.consent) : undefined}
      />

      {/* Submit button */}
      <button
        type="submit"
        form="optin-form"
        disabled={isPending}
        aria-busy={isPending}
        className={[
          'w-full py-3 px-4 rounded-xl text-white font-semibold text-base',
          'transition-all duration-200',
          isPending
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700',
        ].join(' ')}
      >
        {isPending ? t('customer.optin.submitting') : t('customer.optin.submit')}
      </button>
    </form>
  )
}
