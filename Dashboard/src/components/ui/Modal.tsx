/**
 * Modal — accessible modal dialog with focus trap.
 *
 * Accessibility:
 * - role="dialog" + aria-modal="true"
 * - Focus moves to first focusable element on open
 * - Tab cycles within modal
 * - Escape closes modal
 * - Focus returns to trigger element on close
 *
 * Skill: dashboard-crud-page, interface-design
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: ModalSize
  /** If true, clicking the backdrop closes the modal (default: true) */
  closeOnBackdrop?: boolean
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
}

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  // Remember the element that opened the modal
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement
    }
  }, [isOpen])

  // Focus trap + focus initial element
  useEffect(() => {
    if (!isOpen || !dialogRef.current) return

    const dialog = dialogRef.current
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS))

    // Focus the first focusable element
    const firstFocusable = focusables[0]
    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 0)
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }

      if (e.key !== 'Tab') return

      const currentFocusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS))
      if (currentFocusables.length === 0) return

      const first = currentFocusables[0]!
      const last = currentFocusables[currentFocusables.length - 1]!

      if (e.shiftKey) {
        // Shift+Tab: if on first, wrap to last
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        // Tab: if on last, wrap to first
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Restore focus when modal closes
  useEffect(() => {
    if (!isOpen && triggerRef.current) {
      const trigger = triggerRef.current
      setTimeout(() => {
        if (trigger && typeof trigger.focus === 'function') {
          trigger.focus()
        }
      }, 0)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-hidden={!isOpen}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={[
          'relative w-full rounded-xl border border-gray-700 bg-gray-900 shadow-2xl',
          'flex flex-col max-h-[90vh]',
          sizeClasses[size],
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4 shrink-0">
          <h2 id="modal-title" className="text-lg font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-gray-700 px-6 py-4 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
