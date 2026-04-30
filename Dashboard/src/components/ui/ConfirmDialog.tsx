/**
 * ConfirmDialog — confirmation dialog for destructive actions (delete).
 *
 * Wraps Modal with a standardized confirm/cancel layout.
 * Supports children for rendering <CascadePreviewList> when applicable.
 *
 * Skill: dashboard-crud-page
 */

import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  isLoading?: boolean
  children?: ReactNode
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  isLoading = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} isLoading={isLoading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-300">{message}</p>
        {children}
      </div>
    </Modal>
  )
}
