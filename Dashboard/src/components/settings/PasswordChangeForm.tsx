/**
 * PasswordChangeForm — change password with policy validation.
 *
 * Skills: react19-form-pattern, dashboard-crud-page
 *
 * Policy (aligned to backend SecurityPolicy):
 * - Min 8 characters
 * - At least 1 uppercase letter
 * - At least 1 digit
 * - New password != current password
 * - Confirm must match new password
 *
 * Uses useActionState: FormData → validate → call authAPI.changePassword
 */

import { useActionState, useCallback, useId } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { toast } from '@/stores/toastStore'
import { changePassword } from '@/services/authAPI'
import { handleError } from '@/utils/logger'
import type { FormState } from '@/types/form'

interface PasswordFields {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

type PasswordFormState = FormState<PasswordFields> & { cleared?: boolean }

function validatePasswordPolicy(password: string): string | null {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres'
  if (password.length > 128) return 'La contraseña no puede superar los 128 caracteres'
  if (!/[A-Z]/.test(password)) return 'La contraseña debe tener al menos una letra mayúscula'
  if (!/[0-9]/.test(password)) return 'La contraseña debe tener al menos un número'
  return null
}

export function PasswordChangeForm() {
  const formId = useId()

  const submitAction = useCallback(
    async (
      _prev: PasswordFormState,
      formData: FormData,
    ): Promise<PasswordFormState> => {
      const currentPassword = (formData.get('currentPassword') as string ?? '').trim()
      const newPassword = (formData.get('newPassword') as string ?? '').trim()
      const confirmPassword = (formData.get('confirmPassword') as string ?? '').trim()

      const errors: Partial<Record<keyof PasswordFields, string>> = {}

      if (!currentPassword) errors.currentPassword = 'Ingresá tu contraseña actual'

      const policyError = validatePasswordPolicy(newPassword)
      if (policyError) {
        errors.newPassword = policyError
      } else if (newPassword === currentPassword) {
        errors.newPassword = 'La nueva contraseña no puede ser igual a la actual'
      }

      if (!confirmPassword) {
        errors.confirmPassword = 'Confirmá la nueva contraseña'
      } else if (newPassword !== confirmPassword) {
        errors.confirmPassword = 'Las contraseñas no coinciden'
      }

      if (Object.keys(errors).length > 0) return { errors, isSuccess: false }

      try {
        await changePassword({ currentPassword, newPassword })
        toast.success('Contraseña actualizada correctamente')
        return { isSuccess: true, cleared: true }
      } catch (err) {
        const message = handleError(err, 'PasswordChangeForm.submitAction')
        // 400 = wrong current password
        if (message.includes('400') || message.toLowerCase().includes('incorrect') || message.toLowerCase().includes('incorrecta')) {
          return {
            errors: { currentPassword: 'Contraseña actual incorrecta' },
            isSuccess: false,
          }
        }
        toast.error('Error al cambiar la contraseña')
        return { isSuccess: false, message }
      }
    },
    [],
  )

  const [state, formAction, isPending] = useActionState<PasswordFormState, FormData>(
    submitAction,
    { isSuccess: false },
  )

  // Reset the form by keying it on cleared state
  const formKey = state.cleared ? 'cleared' : 'default'

  return (
    <form
      key={formKey}
      id={formId}
      action={formAction}
      className="space-y-4 max-w-md"
      aria-label="Cambiar contraseña"
    >
      {/* Global error message */}
      {state.message && (
        <p role="alert" className="rounded-md bg-red-900/30 border border-red-700 px-4 py-2 text-sm text-red-400">
          {state.message}
        </p>
      )}

      <Input
        label="Contraseña actual"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        error={state.errors?.currentPassword}
        required
        disabled={isPending}
      />

      <Input
        label="Nueva contraseña"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        error={state.errors?.newPassword}
        hint="Mínimo 8 caracteres, una mayúscula y un número"
        required
        disabled={isPending}
      />

      <Input
        label="Confirmar nueva contraseña"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        error={state.errors?.confirmPassword}
        required
        disabled={isPending}
      />

      {/* Password policy hint */}
      <ul className="list-disc list-inside text-xs text-gray-500 space-y-0.5 pl-1">
        <li>Mínimo 8 caracteres</li>
        <li>Al menos una letra mayúscula</li>
        <li>Al menos un número</li>
      </ul>

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          variant="primary"
          isLoading={isPending}
          disabled={isPending}
        >
          Cambiar contraseña
        </Button>
      </div>
    </form>
  )
}
