/**
 * useFormModal — canonical hook for create/edit modal state in CRUD pages.
 *
 * Replaces raw useState for modal open state, selected item, and form data.
 * NEVER use useState directly in a CRUD page for these roles.
 *
 * Skill: dashboard-crud-page
 */

import { useState } from 'react'

export interface UseFormModalReturn<F, E> {
  isOpen: boolean
  selectedItem: E | null
  formData: F
  setFormData: React.Dispatch<React.SetStateAction<F>>
  openCreate: (initial?: Partial<F>) => void
  openEdit: (item: E, mapper: (item: E) => F) => void
  close: () => void
}

/**
 * Manages the modal state for create/edit flows.
 *
 * @param initialFormData - Default/empty form data (used when creating)
 */
export function useFormModal<F, E = unknown>(initialFormData: F): UseFormModalReturn<F, E> {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<E | null>(null)
  const [formData, setFormData] = useState<F>(initialFormData)

  function openCreate(initial?: Partial<F>): void {
    setSelectedItem(null)
    setFormData({ ...initialFormData, ...initial } as F)
    setIsOpen(true)
  }

  function openEdit(item: E, mapper: (item: E) => F): void {
    setSelectedItem(item)
    setFormData(mapper(item))
    setIsOpen(true)
  }

  function close(): void {
    setIsOpen(false)
    // Defer reset to allow close animation to finish
    setTimeout(() => {
      setSelectedItem(null)
      setFormData(initialFormData)
    }, 150)
  }

  return {
    isOpen,
    selectedItem,
    formData,
    setFormData,
    openCreate,
    openEdit,
    close,
  }
}
