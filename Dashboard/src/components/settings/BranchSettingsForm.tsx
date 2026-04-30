/**
 * BranchSettingsForm — branch operational settings form.
 *
 * Skills: react19-form-pattern, dashboard-crud-page, zustand-store-pattern
 *
 * Features:
 * - useActionState pattern: FormData → parse → validate → call store action
 * - Slug change detection: opens SlugChangeDialog before submitting
 * - Field-level error display via FormState.errors
 * - Timezone picker from Intl.supportedValuesOf fallback list
 * - OpeningHoursEditor integration (controlled component)
 * - Pending state disables submit button
 */

import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { OpeningHoursEditor } from '@/components/settings/OpeningHoursEditor'
import { SlugChangeDialog } from '@/components/settings/SlugChangeDialog'
import {
  useSettingsStore,
  selectBranchSettings,
  useSettingsActions,
} from '@/stores/settingsStore'
import { toast } from '@/stores/toastStore'
import { handleError } from '@/utils/logger'
import { isValidSlug, getSupportedTimezones, emptyOpeningHoursWeek } from '@/types/settings'
import type { OpeningHoursWeek } from '@/types/settings'
import type { FormState } from '@/types/form'

interface BranchSettingsFields {
  name: string
  address: string
  slug: string
  phone: string
  timezone: string
}

type BranchFormState = FormState<BranchSettingsFields>

interface BranchSettingsFormProps {
  branchId: string
}

const TIMEZONES = getSupportedTimezones()
const TIMEZONE_OPTIONS = TIMEZONES.map((tz) => ({ value: tz, label: tz }))

export function BranchSettingsForm({ branchId }: BranchSettingsFormProps) {
  const branchSettings = useSettingsStore(selectBranchSettings)
  const { fetchBranchSettings, updateBranchSettings } = useSettingsActions()

  // Opening hours — controlled locally, serialized into FormData hidden field
  const [openingHours, setOpeningHours] = useState<OpeningHoursWeek>(
    branchSettings?.opening_hours ?? emptyOpeningHoursWeek(),
  )

  // Slug change dialog state
  const [slugDialogOpen, setSlugDialogOpen] = useState(false)
  const [pendingSlug, setPendingSlug] = useState('')
  const pendingFormDataRef = useRef<BranchSettingsFields | null>(null)

  // Sync local state when branchSettings loads
  useEffect(() => {
    if (branchSettings?.opening_hours) {
      startTransition(() => setOpeningHours(branchSettings.opening_hours))
    }
  }, [branchSettings])

  // Fetch on mount if not loaded
  useEffect(() => {
    if (!branchSettings) {
      void fetchBranchSettings(branchId)
    }
  }, [branchId, branchSettings, fetchBranchSettings])

  // ---------------------------------------------------------------------------
  // performUpdate — extracted for reuse by both submit action and slug dialog.
  // Defined as useCallback so it captures fresh `openingHours` on each render
  // and can be safely referenced in submitAction's dep array.
  // ---------------------------------------------------------------------------
  const performUpdate = useCallback(
    async (data: BranchSettingsFields): Promise<BranchFormState> => {
      try {
        await updateBranchSettings(branchId, {
          name: data.name,
          address: data.address,
          slug: data.slug,
          phone: data.phone || null,
          timezone: data.timezone,
          opening_hours: openingHours,
        })
        toast.success('Configuración de sucursal guardada')
        return { isSuccess: true }
      } catch (err) {
        const message = handleError(err, 'BranchSettingsForm.performUpdate')
        // Detect 409 Conflict (duplicate slug)
        if (message.includes('409') || message.toLowerCase().includes('slug')) {
          return { errors: { slug: 'Este slug ya está en uso en tu organización' }, isSuccess: false }
        }
        toast.error('Error al guardar la configuración')
        return { isSuccess: false, message }
      }
    },
    [branchId, openingHours, updateBranchSettings],
  )

  // ---------------------------------------------------------------------------
  // Form action (useActionState)
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (
      _prev: BranchFormState,
      formData: FormData,
    ): Promise<BranchFormState> => {
      const data: BranchSettingsFields = {
        name: (formData.get('name') as string ?? '').trim(),
        address: (formData.get('address') as string ?? '').trim(),
        slug: (formData.get('slug') as string ?? '').trim().toLowerCase(),
        phone: (formData.get('phone') as string ?? '').trim(),
        timezone: formData.get('timezone') as string ?? '',
      }

      // Field validation
      const errors: Partial<Record<keyof BranchSettingsFields, string>> = {}
      if (!data.name) errors.name = 'El nombre es requerido'
      if (!data.address) errors.address = 'La dirección es requerida'
      if (!data.slug) {
        errors.slug = 'El slug es requerido'
      } else if (!isValidSlug(data.slug)) {
        errors.slug = 'Solo minúsculas, números y guiones. Entre 3 y 60 caracteres.'
      }
      if (!data.timezone) errors.timezone = 'La zona horaria es requerida'

      if (Object.keys(errors).length > 0) return { errors, isSuccess: false }

      // Detect slug change — open confirmation dialog instead of submitting
      const currentSlug = branchSettings?.slug ?? ''
      if (data.slug !== currentSlug && currentSlug !== '') {
        pendingFormDataRef.current = data
        setPendingSlug(data.slug)
        setSlugDialogOpen(true)
        return { isSuccess: false }
      }

      return performUpdate(data)
    },
    [branchSettings?.slug, performUpdate],
  )

  const [state, formAction, isPending] = useActionState<BranchFormState, FormData>(
    submitAction,
    { isSuccess: false },
  )

  // ---------------------------------------------------------------------------
  // Slug dialog handlers
  // ---------------------------------------------------------------------------
  async function handleSlugConfirm() {
    const data = pendingFormDataRef.current
    if (!data) return
    setSlugDialogOpen(false)
    await performUpdate(data)
    pendingFormDataRef.current = null
  }

  function handleSlugCancel() {
    setSlugDialogOpen(false)
    setPendingSlug('')
    pendingFormDataRef.current = null
  }

  if (!branchSettings) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <>
      <SlugChangeDialog
        isOpen={slugDialogOpen}
        oldSlug={branchSettings.slug}
        newSlug={pendingSlug}
        onConfirm={() => void handleSlugConfirm()}
        onCancel={handleSlugCancel}
        isLoading={isPending}
      />

      <form action={formAction} className="space-y-6 max-w-2xl">
        {/* Global error message */}
        {state.message && (
          <p role="alert" className="rounded-md bg-red-900/30 border border-red-700 px-4 py-2 text-sm text-red-400">
            {state.message}
          </p>
        )}

        {/* Basic info section */}
        <section aria-label="Información básica" className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Información básica
          </h3>

          <Input
            label="Nombre de la sucursal"
            name="name"
            defaultValue={branchSettings.name}
            error={state.errors?.name}
            required
            disabled={isPending}
          />

          <Input
            label="Dirección"
            name="address"
            defaultValue={branchSettings.address}
            error={state.errors?.address}
            required
            disabled={isPending}
          />

          <Input
            label="Teléfono"
            name="phone"
            type="tel"
            defaultValue={branchSettings.phone ?? ''}
            error={state.errors?.phone}
            placeholder="+54 11 1234-5678"
            disabled={isPending}
          />
        </section>

        {/* URL / Slug */}
        <section aria-label="URL del menú público" className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            URL del menú público
          </h3>

          <Input
            label="Slug (identificador URL)"
            name="slug"
            defaultValue={branchSettings.slug}
            error={state.errors?.slug}
            hint="Solo minúsculas, números y guiones (ej: mi-sucursal)"
            required
            disabled={isPending}
          />
        </section>

        {/* Timezone */}
        <section aria-label="Zona horaria" className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Zona horaria
          </h3>

          <Select
            label="Zona horaria"
            name="timezone"
            defaultValue={branchSettings.timezone}
            options={TIMEZONE_OPTIONS}
            error={state.errors?.timezone}
            required
            disabled={isPending}
          />
        </section>

        {/* Opening hours */}
        <section aria-label="Horarios de apertura" className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Horarios de apertura
          </h3>

          <OpeningHoursEditor
            value={openingHours}
            onChange={setOpeningHours}
            disabled={isPending}
          />
        </section>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            variant="primary"
            isLoading={isPending}
            disabled={isPending}
          >
            Guardar configuración
          </Button>
        </div>
      </form>
    </>
  )
}
