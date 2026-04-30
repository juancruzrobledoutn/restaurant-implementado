/**
 * SlugChangeDialog — confirmation dialog for slug changes.
 *
 * WAI-ARIA: role="alertdialog" (destructive action, requires explicit confirmation).
 *
 * UX:
 * - Shows old URL and new URL
 * - User must re-type the new slug exactly to enable the Confirm button
 * - Cancel closes without submitting
 * - Confirm triggers onConfirm callback
 *
 * Skill: dashboard-crud-page, react19-form-pattern
 */

import { startTransition, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface SlugChangeDialogProps {
  isOpen: boolean
  oldSlug: string
  newSlug: string
  onConfirm: () => void
  onCancel: () => void
  isLoading?: boolean
}

export function SlugChangeDialog({
  isOpen,
  oldSlug,
  newSlug,
  onConfirm,
  onCancel,
  isLoading = false,
}: SlugChangeDialogProps) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Reset input when dialog opens
  useEffect(() => {
    if (isOpen) {
      startTransition(() => setTyped(''))
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  const matches = typed === newSlug
  const baseUrl = window.location.origin

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Alert dialog */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="slug-dialog-title"
        aria-describedby="slug-dialog-desc"
        className="relative w-full max-w-md rounded-xl border border-amber-700/50 bg-gray-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-gray-700 px-6 py-4">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <h2 id="slug-dialog-title" className="text-base font-semibold text-white">
            Cambiar URL de la sucursal
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4" id="slug-dialog-desc">
          <p className="text-sm text-gray-300">
            Cambiar el slug afecta la URL pública del menú. Los clientes con la URL anterior dejarán de poder acceder.
          </p>

          {/* URL before/after */}
          <div className="space-y-2 rounded-lg bg-gray-800 p-3 text-xs font-mono">
            <div className="flex items-baseline gap-2">
              <span className="text-gray-500 w-12 shrink-0">Actual:</span>
              <span className="text-red-400 break-all">{baseUrl}/menu/{oldSlug}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-gray-500 w-12 shrink-0">Nueva:</span>
              <span className="text-green-400 break-all">{baseUrl}/menu/{newSlug}</span>
            </div>
          </div>

          {/* Re-type confirmation */}
          <div>
            <p className="text-sm text-gray-400 mb-2">
              Para confirmar, escribí el nuevo slug: <strong className="text-white font-mono">{newSlug}</strong>
            </p>
            <Input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={newSlug}
              aria-label={`Escribi ${newSlug} para confirmar`}
              disabled={isLoading}
              className="font-mono"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-700 px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!matches || isLoading}
            isLoading={isLoading}
            onClick={onConfirm}
          >
            Confirmar cambio
          </Button>
        </div>
      </div>
    </div>
  )
}
