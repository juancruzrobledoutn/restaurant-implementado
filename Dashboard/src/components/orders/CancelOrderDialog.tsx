/**
 * CancelOrderDialog — confirmation dialog to cancel a round (C-25).
 *
 * Requires a cancel_reason (max 500 chars). Disables the submit button
 * while the async cancel is in flight. Shows character counter.
 *
 * Skill: dashboard-crud-page, interface-design
 */

import { useState, useId } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_REASON_LENGTH = 500

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CancelOrderDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
  roundNumber: number | null
  isLoading: boolean
}

export function CancelOrderDialog({
  isOpen,
  onClose,
  onConfirm,
  roundNumber,
  isLoading,
}: CancelOrderDialogProps) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const textareaId = useId()
  const errorId = `${textareaId}-error`

  const isValid = reason.trim().length > 0 && reason.length <= MAX_REASON_LENGTH

  async function handleConfirm() {
    if (!isValid) {
      setError('El motivo de cancelación es obligatorio.')
      return
    }
    setError(null)
    await onConfirm(reason.trim())
    setReason('')
  }

  function handleClose() {
    if (isLoading) return
    setReason('')
    setError(null)
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={roundNumber != null ? `Cancelar ronda #${roundNumber}` : 'Cancelar ronda'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
            Volver
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            isLoading={isLoading}
            disabled={!isValid || isLoading}
          >
            Confirmar cancelación
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-300">
          Esta acción no se puede deshacer. La ronda quedará como cancelada.
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor={textareaId} className="text-sm font-medium text-gray-300">
            Motivo de cancelación
            <span className="ml-1 text-red-400" aria-hidden="true">*</span>
          </label>
          <textarea
            id={textareaId}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              if (error && e.target.value.trim()) setError(null)
            }}
            rows={3}
            maxLength={MAX_REASON_LENGTH}
            placeholder="Describa el motivo..."
            aria-required="true"
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            disabled={isLoading}
            className={[
              'w-full rounded-md border px-3 py-2 text-sm text-white bg-gray-800',
              'placeholder:text-gray-500 resize-none transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-primary/70 focus:border-transparent',
              error
                ? 'border-red-500 focus:ring-red-500/70'
                : 'border-gray-600 hover:border-gray-500',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
          />

          <div className="flex items-center justify-between">
            {error ? (
              <p id={errorId} role="alert" className="text-xs text-red-400">
                {error}
              </p>
            ) : (
              <span />
            )}
            <span
              className={[
                'text-xs ml-auto',
                reason.length >= MAX_REASON_LENGTH ? 'text-red-400' : 'text-gray-500',
              ].join(' ')}
              aria-live="polite"
            >
              {reason.length}/{MAX_REASON_LENGTH}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
