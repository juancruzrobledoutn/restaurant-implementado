/**
 * recipeStore — tenant-scoped recipe management.
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
import type { Recipe, RecipeFormData, RecipeIngredient } from '@/types/menu'

const EMPTY_RECIPES: Recipe[] = []

// ---------------------------------------------------------------------------
// Backend response shape
// ---------------------------------------------------------------------------

interface BackendRecipeIngredient {
  ingredient_id: number
  quantity: number
  unit: string
}

interface BackendRecipe {
  id: number
  tenant_id: number
  product_id: number
  name: string
  ingredients: BackendRecipeIngredient[]
  is_active: boolean
  created_at?: string
  updated_at?: string
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function toRecipeIngredient(b: BackendRecipeIngredient): RecipeIngredient {
  return {
    ingredient_id: String(b.ingredient_id),
    quantity: b.quantity,
    unit: b.unit,
  }
}

function toRecipe(b: BackendRecipe): Recipe {
  return {
    ...b,
    id: String(b.id),
    tenant_id: String(b.tenant_id),
    product_id: String(b.product_id),
    ingredients: b.ingredients.map(toRecipeIngredient),
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface RecipeState {
  items: Recipe[]
  isLoading: boolean
  error: string | null
  pendingTempIds: Set<string>

  fetchAsync: () => Promise<void>
  createAsync: (data: RecipeFormData) => Promise<Recipe>
  updateAsync: (id: string, data: RecipeFormData) => Promise<void>
  deleteAsync: (id: string) => Promise<void>

  applyWSCreated: (data: Record<string, unknown>) => void
  applyWSUpdated: (data: Record<string, unknown>) => void
  applyWSDeleted: (id: string) => void
}

export const useRecipeStore = create<RecipeState>()(
  persist(
    (set, get) => ({
      items: EMPTY_RECIPES,
      isLoading: false,
      error: null,
      pendingTempIds: new Set(),

      fetchAsync: async () => {
        set({ isLoading: true, error: null })
        try {
          const data = await fetchAPI<BackendRecipe[]>('/api/admin/recipes')
          set({ items: data.map(toRecipe), isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'recipeStore.fetchAsync') })
        }
      },

      createAsync: async (data) => {
        const tempId = `temp-${Date.now()}`
        const optimistic: Recipe = { ...data, id: tempId, tenant_id: '', _optimistic: true }
        set((s) => ({
          items: [...s.items, optimistic],
          pendingTempIds: new Set([...s.pendingTempIds, tempId]),
        }))
        try {
          const created = await fetchAPI<BackendRecipe>('/api/admin/recipes', {
            method: 'POST',
            body: {
              ...data,
              product_id: parseInt(data.product_id, 10),
              ingredients: data.ingredients.map((ing) => ({
                ...ing,
                ingredient_id: parseInt(ing.ingredient_id, 10),
              })),
            },
          })
          const real = toRecipe(created)
          set((s) => ({
            items: s.items.map((i) => (i.id === tempId ? real : i)),
            pendingTempIds: (() => { const next = new Set(s.pendingTempIds); next.delete(tempId); return next })(),
          }))
          toast.success('Receta creada correctamente')
          return real
        } catch (err) {
          set((s) => ({
            items: s.items.filter((i) => i.id !== tempId),
            pendingTempIds: (() => { const next = new Set(s.pendingTempIds); next.delete(tempId); return next })(),
            error: handleError(err, 'recipeStore.createAsync'),
          }))
          toast.error('Error al crear la receta')
          throw err
        }
      },

      updateAsync: async (id, data) => {
        const previous = get().items
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...data } : i)) }))
        try {
          const updated = await fetchAPI<BackendRecipe>(`/api/admin/recipes/${id}`, {
            method: 'PUT',
            body: {
              ...data,
              product_id: parseInt(data.product_id, 10),
              ingredients: data.ingredients.map((ing) => ({
                ...ing,
                ingredient_id: parseInt(ing.ingredient_id, 10),
              })),
            },
          })
          set((s) => ({ items: s.items.map((i) => (i.id === id ? toRecipe(updated) : i)) }))
          toast.success('Receta actualizada correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'recipeStore.updateAsync') })
          toast.error('Error al actualizar la receta')
          throw err
        }
      },

      deleteAsync: async (id) => {
        const previous = get().items
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
        try {
          await fetchAPI(`/api/admin/recipes/${id}`, { method: 'DELETE' })
          toast.success('Receta eliminada correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'recipeStore.deleteAsync') })
          toast.error('Error al eliminar la receta')
          throw err
        }
      },

      applyWSCreated: (data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id || get().items.some((i) => i.id === id)) return
        if (get().pendingTempIds.has(id)) return
        set((s) => ({ items: [...s.items, toRecipe(data as unknown as BackendRecipe)] }))
      },

      applyWSUpdated: (data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id) return
        const updated = toRecipe(data as unknown as BackendRecipe)
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
      name: STORAGE_KEYS.RECIPE,
      version: STORE_VERSIONS.RECIPE,
      partialize: (state) => ({ items: state.items }),
      migrate: (persistedState: unknown): RecipeState => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { items: EMPTY_RECIPES, isLoading: false, error: null, pendingTempIds: new Set() } as RecipeState
        }
        const state = persistedState as { items?: unknown }
        return {
          items: Array.isArray(state.items) ? (state.items as Recipe[]) : EMPTY_RECIPES,
          isLoading: false,
          error: null,
          pendingTempIds: new Set(),
        } as RecipeState
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// Named selectors
// ---------------------------------------------------------------------------
export const selectRecipes = (s: RecipeState) => s.items ?? EMPTY_RECIPES
export const selectRecipeIsLoading = (s: RecipeState) => s.isLoading
export const selectRecipeError = (s: RecipeState) => s.error

export const selectRecipesByProduct = (productId: string) => (s: RecipeState) =>
  s.items.filter((r) => r.product_id === productId)

export const useRecipesByProduct = (productId: string) =>
  useRecipeStore(useShallow((s) => s.items.filter((r) => r.product_id === productId)))

export const useRecipeActions = () =>
  useRecipeStore(
    useShallow((s) => ({
      fetchAsync: s.fetchAsync,
      createAsync: s.createAsync,
      updateAsync: s.updateAsync,
      deleteAsync: s.deleteAsync,
    })),
  )
