/**
 * TenantSettingsForm — tenant name settings (ADMIN only).
 *
 * Skills: react19-form-pattern, dashboard-crud-page, zustand-store-pattern
 *
 * Simple form: only tenant name is editable.
 * Note: privacy_salt is NEVER shown or handled in the frontend.
 */

import { useActionState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  useSettingsStore,
  selectTenantSettings,
  useSettingsActions,
} from '@/stores/settingsStore'
import { toast } from '@/stores/toastStore'
import { handleError } from '@/utils/logger'
import type { FormState } from '@/types/form'

interface TenantFields {
  name: string
}

type TenantFormState = FormState<TenantFields>

export function TenantSettingsForm() {
  const tenantSettings = useSettingsStore(selectTenantSettings)
  const { fetchTenantSettings, updateTenantSettings } = useSettingsActions()

  // Fetch on mount if not loaded
  useEffect(() => {
    if (!tenantSettings) {
      void fetchTenantSettings()
    }
  }, [tenantSettings, fetchTenantSettings])

  const submitAction = useCallback(
    async (
      _prev: TenantFormState,
      formData: FormData,
    ): Promise<TenantFormState> => {
      const name = (formData.get('name') as string ?? '').trim()

      const errors: Partial<Record<keyof TenantFields, string>> = {}
      if (!name) errors.name = 'El nombre del negocio es requerido'
      if (name.length > 200) errors.name = 'El nombre no puede superar los 200 caracteres'

      if (Object.keys(errors).length > 0) return { errors, isSuccess: false }

      try {
        await updateTenantSettings({ name })
        toast.success('Nombre del negocio actualizado')
        return { isSuccess: true }
      } catch (err) {
        const message = handleError(err, 'TenantSettingsForm.submitAction')
        toast.error('Error al guardar el nombre del negocio')
        return { isSuccess: false, message }
      }
    },
    [updateTenantSettings],
  )

  const [state, formAction, isPending] = useActionState<TenantFormState, FormData>(
    submitAction,
    { isSuccess: false },
  )

  if (!tenantSettings) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-6 max-w-md" aria-label="Configuración del negocio">
      {/* Global error */}
      {state.message && (
        <p role="alert" className="rounded-md bg-red-900/30 border border-red-700 px-4 py-2 text-sm text-red-400">
          {state.message}
        </p>
      )}

      <section aria-label="Nombre del negocio" className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Nombre del negocio
        </h3>

        <Input
          label="Nombre del negocio (Tenant)"
          name="name"
          defaultValue={tenantSettings.name}
          error={state.errors?.name}
          hint="Este nombre es visible para todos los usuarios de tu organización"
          required
          disabled={isPending}
        />
      </section>

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          variant="primary"
          isLoading={isPending}
          disabled={isPending}
        >
          Guardar nombre
        </Button>
      </div>
    </form>
  )
}
