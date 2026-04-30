/**
 * useConfirmDialog — canonical hook for delete confirmation dialogs.
 *
 * Replaces raw useState for delete dialog state in CRUD pages.
 * NEVER use useState directly in a CRUD page for this role.
 *
 * Skill: dashboard-crud-page
 */

import { useState } from 'react'

export interface UseConfirmDialogReturn<E> {
  isOpen: boolean
  item: E | null
  open: (item: E) => void
  close: () => void
}

/**
 * Manages the state of a delete confirmation dialog.
 */
export function useConfirmDialog<E>(): UseConfirmDialogReturn<E> {
  const [isOpen, setIsOpen] = useState(false)
  const [item, setItem] = useState<E | null>(null)

  function open(target: E): void {
    setItem(target)
    setIsOpen(true)
  }

  function close(): void {
    setIsOpen(false)
    // Defer item reset to allow close animation to finish
    setTimeout(() => {
      setItem(null)
    }, 150)
  }

  return {
    isOpen,
    item,
    open,
    close,
  }
}
