/**
 * ManualPaymentForm — React 19 useActionState form for manual payment registration.
 *
 * Validates: amount > 0, method ∈ {cash, card, transfer}.
 * Integrates with useEnqueuedAction for offline resilience.
 */
import { useActionState, useCallback } from 'react'
import { logger } from '@/utils/logger'

export interface ManualPaymentFormData {
  sessionId: string
  amountCents: number
  method: 'cash' | 'card' | 'transfer'
  reference?: string
}

type PaymentFormState = {
  isSuccess?: boolean
  message?: string
  errors?: {
    amount?: string
    method?: string
  }
  status?: 'idle' | 'queued' | 'sending' | 'success' | 'failed'
}

interface Props {
  sessionId: string
  onSuccess?: () => void
  onSubmit: (data: ManualPaymentFormData) => Promise<{ status: string; message?: string }>
}

const INITIAL_STATE: PaymentFormState = { isSuccess: false, status: 'idle' }

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
}

export function ManualPaymentForm({ sessionId, onSuccess, onSubmit }: Props) {
  const submitAction = useCallback(
    async (_prevState: PaymentFormState, formData: FormData): Promise<PaymentFormState> => {
      // 1. Extract fields
      const rawAmount = formData.get('amount') as string
      const method = formData.get('method') as string
      const reference = formData.get('reference') as string | null

      // 2. Parse amount (user enters dollars, we store cents)
      const amountFloat = parseFloat(rawAmount || '0')
      const amountCents = Math.round(amountFloat * 100)

      // 3. Validate
      const errors: PaymentFormState['errors'] = {}
      if (!amountCents || amountCents <= 0) {
        errors.amount = 'El monto debe ser mayor a cero'
      }
      if (!['cash', 'card', 'transfer'].includes(method)) {
        errors.method = 'Seleccioná un método de pago'
      }
      if (Object.keys(errors).length > 0) {
        return { isSuccess: false, errors }
      }

      try {
        const result = await onSubmit({
          sessionId,
          amountCents,
          method: method as 'cash' | 'card' | 'transfer',
          reference: reference || undefined,
        })

        if (result.status === 'queued') {
          return {
            isSuccess: false,
            status: 'queued',
            message: 'Pago guardado — se sincronizará cuando haya conexión',
          }
        }

        onSuccess?.()
        return { isSuccess: true, status: 'success', message: 'Pago registrado correctamente' }
      } catch (err) {
        logger.error('ManualPaymentForm: submit failed', err)
        const msg = err instanceof Error ? err.message : 'Error al registrar el pago'
        return { isSuccess: false, status: 'failed', message: msg }
      }
    },
    [sessionId, onSubmit, onSuccess],
  )

  const [state, formAction, isPending] = useActionState<PaymentFormState, FormData>(
    submitAction,
    INITIAL_STATE,
  )

  return (
    <form action={formAction} className="space-y-4">
      {/* Amount */}
      <div>
        <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
          Monto ($)
        </label>
        <input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          required
        />
        {state.errors?.amount && (
          <p className="mt-1 text-xs text-red-600">{state.errors.amount}</p>
        )}
      </div>

      {/* Method */}
      <div>
        <label htmlFor="method" className="block text-sm font-medium text-gray-700">
          Método de pago
        </label>
        <select
          id="method"
          name="method"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          required
        >
          <option value="">— Seleccioná —</option>
          {Object.entries(METHOD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {state.errors?.method && (
          <p className="mt-1 text-xs text-red-600">{state.errors.method}</p>
        )}
      </div>

      {/* Reference (optional) */}
      <div>
        <label htmlFor="reference" className="block text-sm font-medium text-gray-700">
          Referencia (opcional)
        </label>
        <input
          id="reference"
          name="reference"
          type="text"
          placeholder="Nro. de comprobante, etc."
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Status messages */}
      {state.message && !state.errors && (
        <p className={`text-sm ${state.isSuccess || state.status === 'queued' ? 'text-green-700' : 'text-red-600'}`}>
          {state.message}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
      >
        {isPending ? 'Procesando…' : 'Registrar pago'}
      </button>
    </form>
  )
}
