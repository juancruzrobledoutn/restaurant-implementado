/**
 * categoryStore — branch-scoped category management.
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
import type { Category, CategoryFormData } from '@/types/menu'

const EMPTY_CATEGORIES: Category[] = []

interface BackendCategory {
  id: number
  tenant_id: number
  branch_id: number
  name: string
  order: number
  icon?: string
  image?: string
  is_active: boolean
  created_at?: string
  updated_at?: string
}

function toCategory(b: BackendCategory): Category {
  return {
    ...b,
    id: String(b.id),
    tenant_id: String(b.tenant_id),
    branch_id: String(b.branch_id),
  }
}

interface CategoryState {
  items: Category[]
  isLoading: boolean
  error: string | null
  pendingTempIds: Set<string>

  fetchAsync: () => Promise<void>
  createAsync: (data: CategoryFormData) => Promise<Category>
  updateAsync: (id: string, data: CategoryFormData) => Promise<void>
  deleteAsync: (id: string) => Promise<void>

  applyWSCreated: (data: Record<string, unknown>) => void
  applyWSUpdated: (data: Record<string, unknown>) => void
  applyWSDeleted: (id: string) => void
}

export const useCategoryStore = create<CategoryState>()(
  persist(
    (set, get) => ({
      items: EMPTY_CATEGORIES,
      isLoading: false,
      error: null,
      pendingTempIds: new Set(),

      fetchAsync: async () => {
        set({ isLoading: true, error: null })
        try {
          const data = await fetchAPI<BackendCategory[]>('/api/admin/categories')
          set({ items: data.map(toCategory), isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'categoryStore.fetchAsync') })
        }
      },

      createAsync: async (data) => {
        const tempId = `temp-${Date.now()}`
        const optimistic: Category = {
          ...data,
          id: tempId,
          tenant_id: '',
          is_active: true,
          _optimistic: true,
        }
        set((s) => ({
          items: [...s.items, optimistic],
          pendingTempIds: new Set([...s.pendingTempIds, tempId]),
        }))
        try {
          const created = await fetchAPI<BackendCategory>('/api/admin/categories', {
            method: 'POST',
            body: { ...data, branch_id: parseInt(data.branch_id, 10) },
          })
          const real = toCategory(created)
          set((s) => ({
            items: s.items.map((i) => (i.id === tempId ? real : i)),
            pendingTempIds: (() => { const next = new Set(s.pendingTempIds); next.delete(tempId); return next })(),
          }))
          toast.success('Categoría creada correctamente')
          return real
        } catch (err) {
          set((s) => ({
            items: s.items.filter((i) => i.id !== tempId),
            pendingTempIds: (() => { const next = new Set(s.pendingTempIds); next.delete(tempId); return next })(),
            error: handleError(err, 'categoryStore.createAsync'),
          }))
          toast.error('Error al crear la categoría')
          throw err
        }
      },

      updateAsync: async (id, data) => {
        const previous = get().items
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...data } : i)) }))
        try {
          const updated = await fetchAPI<BackendCategory>(`/api/admin/categories/${id}`, { method: 'PUT', body: data })
          set((s) => ({ items: s.items.map((i) => (i.id === id ? toCategory(updated) : i)) }))
          toast.success('Categoría actualizada correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'categoryStore.updateAsync') })
          toast.error('Error al actualizar la categoría')
          throw err
        }
      },

      deleteAsync: async (id) => {
        const previous = get().items
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
        try {
          await fetchAPI(`/api/admin/categories/${id}`, { method: 'DELETE' })
          toast.success('Categoría eliminada correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'categoryStore.deleteAsync') })
          toast.error('Error al eliminar la categoría')
          throw err
        }
      },

      applyWSCreated: (data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id || get().items.some((i) => i.id === id)) return
        if (get().pendingTempIds.has(id)) return
        set((s) => ({ items: [...s.items, toCategory(data as unknown as BackendCategory)] }))
      },

      applyWSUpdated: (data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id) return
        const updated = toCategory(data as unknown as BackendCategory)
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
      name: STORAGE_KEYS.CATEGORY,
      version: STORE_VERSIONS.CATEGORY,
      partialize: (state) => ({ items: state.items }),
      migrate: (persistedState: unknown): CategoryState => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { items: EMPTY_CATEGORIES, isLoading: false, error: null, pendingTempIds: new Set() } as CategoryState
        }
        const state = persistedState as { items?: unknown }
        return {
          items: Array.isArray(state.items) ? (state.items as Category[]) : EMPTY_CATEGORIES,
          isLoading: false,
          error: null,
          pendingTempIds: new Set(),
        } as CategoryState
      },
    },
  ),
)

export const selectCategories = (s: CategoryState) => s.items ?? EMPTY_CATEGORIES
export const selectCategoryIsLoading = (s: CategoryState) => s.isLoading
export const selectCategoryError = (s: CategoryState) => s.error

export const useCategoriesByBranch = (branchId: string) =>
  useCategoryStore(useShallow((s) => s.items.filter((c) => c.branch_id === branchId)))

export const useCategoryActions = () =>
  useCategoryStore(
    useShallow((s) => ({
      fetchAsync: s.fetchAsync,
      createAsync: s.createAsync,
      updateAsync: s.updateAsync,
      deleteAsync: s.deleteAsync,
    })),
  )
