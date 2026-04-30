/**
 * toastStore — global toast notifications for the Dashboard.
 *
 * API: module-level functions (not hooks) so they can be called from
 * useActionState action functions and store actions without a React context.
 *
 * Usage:
 *   import { toast } from '@/stores/toastStore'
 *   toast.success('Categoria creada correctamente')
 *   toast.error('Error al guardar')
 *
 * Skill: zustand-store-pattern
 */

import { create } from 'zustand'

export type ToastVariant = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  variant: ToastVariant
}

interface ToastState {
  toasts: Toast[]
  add: (message: string, variant: ToastVariant) => void
  dismiss: (id: string) => void
}

const AUTO_DISMISS_MS = 4000

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  add: (message, variant) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set((state) => ({
      toasts: [...state.toasts, { id, message, variant }],
    }))
    // Auto-dismiss
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }))
    }, AUTO_DISMISS_MS)
  },

  dismiss: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },
}))

// ---------------------------------------------------------------------------
// Module-level API — callable from anywhere (stores, actions, effects)
// ---------------------------------------------------------------------------

export const toast = {
  success: (message: string) => useToastStore.getState().add(message, 'success'),
  error: (message: string) => useToastStore.getState().add(message, 'error'),
  info: (message: string) => useToastStore.getState().add(message, 'info'),
}

// ---------------------------------------------------------------------------
// Named selectors
// ---------------------------------------------------------------------------

export const selectToasts = (s: ToastState) => s.toasts
