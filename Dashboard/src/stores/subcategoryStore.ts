/**
 * subcategoryStore — branch-scoped subcategory management.
 *
 * Skill: zustand-store-pattern
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/utils/constants'
import { fetchAPI } from '@/services/api'
import { toast } from '@/stores/toastStore'
import { handleError } from '@/utils/logger'
import type { Subcategory, SubcategoryFormData } from '@/types/menu'

const EMPTY_SUBCATEGORIES: Subcategory[] = []

interface BackendSubcategory {
  id: number
  tenant_id: number
  branch_id: number
  category_id: number
  name: string
  order: number
  image?: string
  is_active: boolean
  created_at?: string
  updated_at?: string
}

function toSubcategory(b: BackendSubcategory): Subcategory {
  return {
    ...b,
    id: String(b.id),
    tenant_id: String(b.tenant_id),
    branch_id: String(b.branch_id),
    category_id: String(b.category_id),
  }
}

interface SubcategoryState {
  items: Subcategory[]
  isLoading: boolean
  error: string | null
  pendingTempIds: Set<string>

  fetchAsync: () => Promise<void>
  createAsync: (data: SubcategoryFormData) => Promise<Subcategory>
  updateAsync: (id: string, data: SubcategoryFormData) => Promise<void>
  deleteAsync: (id: string) => Promise<void>

  applyWSCreated: (data: Record<string, unknown>) => void
  applyWSUpdated: (data: Record<string, unknown>) => void
  applyWSDeleted: (id: string) => void
}

export const useSubcategoryStore = create<SubcategoryState>()(
  persist(
    (set, get) => ({
      items: EMPTY_SUBCATEGORIES,
      isLoading: false,
      error: null,
      pendingTempIds: new Set(),

      fetchAsync: async () => {
        set({ isLoading: true, error: null })
        try {
          const data = await fetchAPI<BackendSubcategory[]>('/api/admin/subcategories')
          set({ items: data.map(toSubcategory), isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'subcategoryStore.fetchAsync') })
        }
      },

      createAsync: async (data) => {
        const tempId = `temp-${Date.now()}`
        const optimistic: Subcategory = { ...data, id: tempId, tenant_id: '', is_active: true, _optimistic: true }
        set((s) => ({
          items: [...s.items, optimistic],
          pendingTempIds: new Set([...s.pendingTempIds, tempId]),
        }))
        try {
          const created = await fetchAPI<BackendSubcategory>('/api/admin/subcategories', { method: 'POST', body: data })
          const real = toSubcategory(created)
          set((s) => ({
            items: s.items.map((i) => (i.id === tempId ? real : i)),
            pendingTempIds: (() => { const next = new Set(s.pendingTempIds); next.delete(tempId); return next })(),
          }))
          toast.success('Subcategoría creada correctamente')
          return real
        } catch (err) {
          set((s) => ({
            items: s.items.filter((i) => i.id !== tempId),
            pendingTempIds: (() => { const next = new Set(s.pendingTempIds); next.delete(tempId); return next })(),
            error: handleError(err, 'subcategoryStore.createAsync'),
          }))
          toast.error('Error al crear la subcategoría')
          throw err
        }
      },

      updateAsync: async (id, data) => {
        const previous = get().items
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...data } : i)) }))
        try {
          const updated = await fetchAPI<BackendSubcategory>(`/api/admin/subcategories/${id}`, { method: 'PUT', body: data })
          set((s) => ({ items: s.items.map((i) => (i.id === id ? toSubcategory(updated) : i)) }))
          toast.success('Subcategoría actualizada correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'subcategoryStore.updateAsync') })
          toast.error('Error al actualizar la subcategoría')
          throw err
        }
      },

      deleteAsync: async (id) => {
        const previous = get().items
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
        try {
          await fetchAPI(`/api/admin/subcategories/${id}`, { method: 'DELETE' })
          toast.success('Subcategoría eliminada correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'subcategoryStore.deleteAsync') })
          toast.error('Error al eliminar la subcategoría')
          throw err
        }
      },

      applyWSCreated: (data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id || get().items.some((i) => i.id === id)) return
        set((s) => ({ items: [...s.items, toSubcategory(data as unknown as BackendSubcategory)] }))
      },

      applyWSUpdated: (data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id) return
        const updated = toSubcategory(data as unknown as BackendSubcategory)
        set((s) => ({
          items: s.items.some((i) => i.id === id)
            ? s.items.map((i) => (i.id === id ? { ...i, ...updated } : i))
            : [...s.items, updated],
        }))
      },

      applyWSDeleted: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
      },
    }),
    {
      name: STORAGE_KEYS.SUBCATEGORY,
      version: STORE_VERSIONS.SUBCATEGORY,
      partialize: (state) => ({ items: state.items }),
      migrate: (persistedState: unknown): SubcategoryState => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { items: EMPTY_SUBCATEGORIES, isLoading: false, error: null, pendingTempIds: new Set() } as SubcategoryState
        }
        const state = persistedState as { items?: unknown }
        return {
          items: Array.isArray(state.items) ? (state.items as Subcategory[]) : EMPTY_SUBCATEGORIES,
          isLoading: false,
          error: null,
          pendingTempIds: new Set(),
        } as SubcategoryState
      },
    },
  ),
)

export const selectSubcategories = (s: SubcategoryState) => s.items ?? EMPTY_SUBCATEGORIES

export const useSubcategoriesByCategory = (categoryId: string) =>
  useSubcategoryStore(useShallow((s) => s.items.filter((sc) => sc.category_id === categoryId)))
