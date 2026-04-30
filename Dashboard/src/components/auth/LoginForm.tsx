/**
 * LoginForm — email + password + optional TOTP form.
 *
 * React 19 pattern (skill: react19-form-pattern):
 * - useActionState instead of useState + onSubmit
 * - form uses action={formAction}, NOT onSubmit
 * - isPending from useActionState for loading state
 */

import { useActionState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormState } from '@/types/form'

interface LoginFormData {
  email: string
  password: string
  totpCode?: string
}

interface LoginFormProps {
  onSubmit: (email: string, password: string, totpCode?: string) => Promise<void>
  requires2fa: boolean
}

export function LoginForm({ onSubmit, requires2fa }: LoginFormProps) {
  const { t } = useTranslation()

  const submitAction = useCallback(
    async (_prevState: FormState<LoginFormData>, formData: FormData): Promise<FormState<LoginFormData>> => {
      const email = formData.get('email') as string
      const password = formData.get('password') as string
      const totpCode = formData.get('totp') as string | null

      // Client-side presence validation
      const errors: FormState<LoginFormData>['errors'] = {}
      if (!email?.trim()) errors.email = t('validation.required')
      if (!password) errors.password = t('validation.required')
      if (requires2fa && !totpCode?.trim()) errors.totpCode = t('validation.required')

      if (Object.keys(errors).length > 0) {
        return { errors, isSuccess: false }
      }

      try {
        await onSubmit(email, password, requires2fa ? (totpCode ?? undefined) : undefined)
        return { isSuccess: true }
      } catch {
        // onSubmit (authStore.login) handles its own error state via the store.
        // We return isSuccess: false to keep the form active.
        return { isSuccess: false }
      }
    },
    [onSubmit, requires2fa, t]
  )

  const [state, formAction, isPending] = useActionState<FormState<LoginFormData>, FormData>(
    submitAction,
    { isSuccess: false }
  )

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {/* Email */}
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {t('auth.login.email')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          placeholder={t('auth.login.emailPlaceholder')}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {state.errors?.email && (
          <p className="mt-1 text-xs text-red-600">{state.errors.email}</p>
        )}
      </div>

      {/* Password */}
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {t('auth.login.password')}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={isPending}
          placeholder={t('auth.login.passwordPlaceholder')}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {state.errors?.password && (
          <p className="mt-1 text-xs text-red-600">{state.errors.password}</p>
        )}
      </div>

      {/* TOTP — shown only when backend says requires_2fa */}
      {requires2fa && (
        <div>
          <label
            htmlFor="totp"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {t('auth.login.totp.label')}
          </label>
          <input
            id="totp"
            name="totp"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
            disabled={isPending}
            placeholder={t('auth.login.totp.placeholder')}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 text-center tracking-widest font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {state.errors?.totpCode && (
            <p className="mt-1 text-xs text-red-600">{state.errors.totpCode}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">{t('auth.login.totp.hint')}</p>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPending ? t('auth.login.submitting') : t('auth.login.submit')}
      </button>
    </form>
  )
}
