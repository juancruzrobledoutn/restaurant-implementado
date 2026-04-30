/**
 * ingredientStore — tenant-scoped IngredientGroup → Ingredient → SubIngredient hierarchy.
 *
 * Skill: zustand-store-pattern
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/utils/constants'
import { fetchAPI } from '@/services/api'
import { toast } from '@/stores/toastStore'
import { logger, handleError } from '@/utils/logger'
import type {
  IngredientGroup,
  IngredientGroupFormData,
  Ingredient,
  IngredientFormData,
  SubIngredient,
  SubIngredientFormData,
} from '@/types/menu'

const EMPTY_GROUPS: IngredientGroup[] = []
const EMPTY_INGREDIENTS: Ingredient[] = []
const EMPTY_SUB_INGREDIENTS: SubIngredient[] = []

interface BackendIngredientGroup {
  id: number
  tenant_id: number
  name: string
  is_active: boolean
  created_at?: string
  updated_at?: string
}

interface BackendIngredient {
  id: number
  group_id: number
  tenant_id: number
  name: string
  unit?: string
  is_active: boolean
  created_at?: string
  updated_at?: string
}

interface BackendSubIngredient {
  id: number
  ingredient_id: number
  tenant_id: number
  name: string
  quantity?: number
  unit?: string
  is_active: boolean
}

function toGroup(b: BackendIngredientGroup): IngredientGroup {
  return { ...b, id: String(b.id), tenant_id: String(b.tenant_id) }
}

function toIngredient(b: BackendIngredient): Ingredient {
  return { ...b, id: String(b.id), group_id: String(b.group_id), tenant_id: String(b.tenant_id) }
}

function toSubIngredient(b: BackendSubIngredient): SubIngredient {
  return {
    ...b,
    id: String(b.id),
    ingredient_id: String(b.ingredient_id),
    tenant_id: String(b.tenant_id),
  }
}

interface IngredientState {
  groups: IngredientGroup[]
  ingredients: Ingredient[]
  subIngredients: SubIngredient[]
  isLoading: boolean
  error: string | null
  pendingTempIds: Set<string>

  fetchGroupsAsync: () => Promise<void>
  createGroupAsync: (data: IngredientGroupFormData) => Promise<IngredientGroup>
  updateGroupAsync: (id: string, data: IngredientGroupFormData) => Promise<void>
  deleteGroupAsync: (id: string) => Promise<void>

  createIngredientAsync: (data: IngredientFormData) => Promise<Ingredient>
  updateIngredientAsync: (id: string, data: IngredientFormData) => Promise<void>
  deleteIngredientAsync: (id: string) => Promise<void>

  createSubIngredientAsync: (data: SubIngredientFormData) => Promise<SubIngredient>
  updateSubIngredientAsync: (id: string, data: SubIngredientFormData) => Promise<void>
  deleteSubIngredientAsync: (id: string) => Promise<void>

  applyWSCreated: (entity: string, data: Record<string, unknown>) => void
  applyWSUpdated: (entity: string, data: Record<string, unknown>) => void
  applyWSDeleted: (entity: string, id: string) => void
}

export const useIngredientStore = create<IngredientState>()(
  persist(
    (set, get) => ({
      groups: EMPTY_GROUPS,
      ingredients: EMPTY_INGREDIENTS,
      subIngredients: EMPTY_SUB_INGREDIENTS,
      isLoading: false,
      error: null,
      pendingTempIds: new Set(),

      fetchGroupsAsync: async () => {
        set({ isLoading: true, error: null })
        try {
          const groups = await fetchAPI<BackendIngredientGroup[]>('/api/admin/ingredients')
          set({ groups: groups.map(toGroup), isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'ingredientStore.fetchGroupsAsync') })
        }
      },

      createGroupAsync: async (data) => {
        const tempId = `temp-${Date.now()}`
        const optimistic: IngredientGroup = { ...data, id: tempId, tenant_id: '', _optimistic: true }
        set((s) => ({ groups: [...s.groups, optimistic] }))
        try {
          const created = await fetchAPI<BackendIngredientGroup>('/api/admin/ingredients', {
            method: 'POST',
            body: data,
          })
          const real = toGroup(created)
          set((s) => ({ groups: s.groups.map((g) => (g.id === tempId ? real : g)) }))
          toast.success('Grupo creado correctamente')
          return real
        } catch (err) {
          set((s) => ({ groups: s.groups.filter((g) => g.id !== tempId), error: handleError(err, 'ingredientStore.createGroupAsync') }))
          toast.error('Error al crear el grupo')
          throw err
        }
      },

      updateGroupAsync: async (id, data) => {
        const previous = get().groups
        set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, ...data } : g)) }))
        try {
          const updated = await fetchAPI<BackendIngredientGroup>(`/api/admin/ingredients/${id}`, { method: 'PUT', body: data })
          set((s) => ({ groups: s.groups.map((g) => (g.id === id ? toGroup(updated) : g)) }))
          toast.success('Grupo actualizado correctamente')
        } catch (err) {
          set({ groups: previous, error: handleError(err, 'ingredientStore.updateGroupAsync') })
          toast.error('Error al actualizar el grupo')
          throw err
        }
      },

      deleteGroupAsync: async (id) => {
        const prevGroups = get().groups
        const prevIngredients = get().ingredients
        const prevSubs = get().subIngredients
        // Remove group + children optimistically
        const ingredientIds = new Set(get().ingredients.filter((i) => i.group_id === id).map((i) => i.id))
        set((s) => ({
          groups: s.groups.filter((g) => g.id !== id),
          ingredients: s.ingredients.filter((i) => i.group_id !== id),
          subIngredients: s.subIngredients.filter((s2) => !ingredientIds.has(s2.ingredient_id)),
        }))
        try {
          await fetchAPI(`/api/admin/ingredients/${id}`, { method: 'DELETE' })
          toast.success('Grupo eliminado correctamente')
        } catch (err) {
          set({ groups: prevGroups, ingredients: prevIngredients, subIngredients: prevSubs, error: handleError(err, 'ingredientStore.deleteGroupAsync') })
          toast.error('Error al eliminar el grupo')
          throw err
        }
      },

      createIngredientAsync: async (data) => {
        const tempId = `temp-${Date.now()}`
        const optimistic: Ingredient = { ...data, id: tempId, tenant_id: '', _optimistic: true }
        set((s) => ({ ingredients: [...s.ingredients, optimistic] }))
        try {
          const created = await fetchAPI<BackendIngredient>(`/api/admin/ingredients/${data.group_id}/items`, { method: 'POST', body: data })
          const real = toIngredient(created)
          set((s) => ({ ingredients: s.ingredients.map((i) => (i.id === tempId ? real : i)) }))
          toast.success('Ingrediente creado correctamente')
          return real
        } catch (err) {
          set((s) => ({ ingredients: s.ingredients.filter((i) => i.id !== tempId), error: handleError(err, 'ingredientStore.createIngredientAsync') }))
          toast.error('Error al crear el ingrediente')
          throw err
        }
      },

      updateIngredientAsync: async (id, data) => {
        const previous = get().ingredients
        set((s) => ({ ingredients: s.ingredients.map((i) => (i.id === id ? { ...i, ...data } : i)) }))
        try {
          const updated = await fetchAPI<BackendIngredient>(`/api/admin/ingredients/items/${id}`, { method: 'PUT', body: data })
          set((s) => ({ ingredients: s.ingredients.map((i) => (i.id === id ? toIngredient(updated) : i)) }))
          toast.success('Ingrediente actualizado correctamente')
        } catch (err) {
          set({ ingredients: previous, error: handleError(err, 'ingredientStore.updateIngredientAsync') })
          toast.error('Error al actualizar el ingrediente')
          throw err
        }
      },

      deleteIngredientAsync: async (id) => {
        const prevIngredients = get().ingredients
        const prevSubs = get().subIngredients
        set((s) => ({
          ingredients: s.ingredients.filter((i) => i.id !== id),
          subIngredients: s.subIngredients.filter((s2) => s2.ingredient_id !== id),
        }))
        try {
          await fetchAPI(`/api/admin/ingredients/items/${id}`, { method: 'DELETE' })
          toast.success('Ingrediente eliminado correctamente')
        } catch (err) {
          set({ ingredients: prevIngredients, subIngredients: prevSubs, error: handleError(err, 'ingredientStore.deleteIngredientAsync') })
          toast.error('Error al eliminar el ingrediente')
          throw err
        }
      },

      createSubIngredientAsync: async (data) => {
        const tempId = `temp-${Date.now()}`
        const optimistic: SubIngredient = { ...data, id: tempId, tenant_id: '', _optimistic: true }
        set((s) => ({ subIngredients: [...s.subIngredients, optimistic] }))
        try {
          const created = await fetchAPI<BackendSubIngredient>(`/api/admin/ingredients/${data.ingredient_id}/items/${data.ingredient_id}/subs`, { method: 'POST', body: data })
          const real = toSubIngredient(created)
          set((s) => ({ subIngredients: s.subIngredients.map((s2) => (s2.id === tempId ? real : s2)) }))
          toast.success('Sub-ingrediente creado correctamente')
          return real
        } catch (err) {
          set((s) => ({ subIngredients: s.subIngredients.filter((s2) => s2.id !== tempId), error: handleError(err, 'ingredientStore.createSubIngredientAsync') }))
          toast.error('Error al crear el sub-ingrediente')
          throw err
        }
      },

      updateSubIngredientAsync: async (id, data) => {
        const previous = get().subIngredients
        set((s) => ({ subIngredients: s.subIngredients.map((s2) => (s2.id === id ? { ...s2, ...data } : s2)) }))
        try {
          await fetchAPI(`/api/admin/ingredients/subs/${id}`, { method: 'PUT', body: data })
          toast.success('Sub-ingrediente actualizado correctamente')
        } catch (err) {
          set({ subIngredients: previous, error: handleError(err, 'ingredientStore.updateSubIngredientAsync') })
          toast.error('Error al actualizar el sub-ingrediente')
          throw err
        }
      },

      deleteSubIngredientAsync: async (id) => {
        const previous = get().subIngredients
        set((s) => ({ subIngredients: s.subIngredients.filter((s2) => s2.id !== id) }))
        try {
          await fetchAPI(`/api/admin/ingredients/subs/${id}`, { method: 'DELETE' })
          toast.success('Sub-ingrediente eliminado correctamente')
        } catch (err) {
          set({ subIngredients: previous, error: handleError(err, 'ingredientStore.deleteSubIngredientAsync') })
          toast.error('Error al eliminar el sub-ingrediente')
          throw err
        }
      },

      applyWSCreated: (entity, data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id) return
        if (entity === 'ingredient_group') {
          if (get().groups.some((g) => g.id === id)) return
          set((s) => ({ groups: [...s.groups, toGroup(data as unknown as BackendIngredientGroup)] }))
        } else if (entity === 'ingredient') {
          if (get().ingredients.some((i) => i.id === id)) return
          set((s) => ({ ingredients: [...s.ingredients, toIngredient(data as unknown as BackendIngredient)] }))
        } else if (entity === 'sub_ingredient') {
          if (get().subIngredients.some((s2) => s2.id === id)) return
          set((s) => ({ subIngredients: [...s.subIngredients, toSubIngredient(data as unknown as BackendSubIngredient)] }))
        }
        logger.debug(`ingredientStore: WS created ${entity}`, data)
      },

      applyWSUpdated: (entity, data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id) return
        if (entity === 'ingredient_group') {
          const updated = toGroup(data as unknown as BackendIngredientGroup)
          set((s) => ({ groups: s.groups.some((g) => g.id === id) ? s.groups.map((g) => (g.id === id ? { ...g, ...updated } : g)) : [...s.groups, updated] }))
        } else if (entity === 'ingredient') {
          const updated = toIngredient(data as unknown as BackendIngredient)
          set((s) => ({ ingredients: s.ingredients.some((i) => i.id === id) ? s.ingredients.map((i) => (i.id === id ? { ...i, ...updated } : i)) : [...s.ingredients, updated] }))
        } else if (entity === 'sub_ingredient') {
          const updated = toSubIngredient(data as unknown as BackendSubIngredient)
          set((s) => ({ subIngredients: s.subIngredients.some((s2) => s2.id === id) ? s.subIngredients.map((s2) => (s2.id === id ? { ...s2, ...updated } : s2)) : [...s.subIngredients, updated] }))
        }
      },

      applyWSDeleted: (entity, id) => {
        if (entity === 'ingredient_group') {
          set((s) => ({ groups: s.groups.filter((g) => g.id !== id) }))
        } else if (entity === 'ingredient') {
          set((s) => ({ ingredients: s.ingredients.filter((i) => i.id !== id) }))
        } else if (entity === 'sub_ingredient') {
          set((s) => ({ subIngredients: s.subIngredients.filter((s2) => s2.id !== id) }))
        }
      },
    }),
    {
      name: STORAGE_KEYS.INGREDIENT,
      version: STORE_VERSIONS.INGREDIENT,
      partialize: (state) => ({
        groups: state.groups,
        ingredients: state.ingredients,
        subIngredients: state.subIngredients,
      }),
      migrate: (persistedState: unknown, _version: number): IngredientState => {
        if (!persistedState || typeof persistedState !== 'object') {
          return {
            groups: EMPTY_GROUPS,
            ingredients: EMPTY_INGREDIENTS,
            subIngredients: EMPTY_SUB_INGREDIENTS,
            isLoading: false,
            error: null,
            pendingTempIds: new Set(),
          } as IngredientState
        }
        const state = persistedState as {
          groups?: unknown
          ingredients?: unknown
          subIngredients?: unknown
        }
        return {
          groups: Array.isArray(state.groups) ? (state.groups as IngredientGroup[]) : EMPTY_GROUPS,
          ingredients: Array.isArray(state.ingredients) ? (state.ingredients as Ingredient[]) : EMPTY_INGREDIENTS,
          subIngredients: Array.isArray(state.subIngredients) ? (state.subIngredients as SubIngredient[]) : EMPTY_SUB_INGREDIENTS,
          isLoading: false,
          error: null,
          pendingTempIds: new Set(),
        } as IngredientState
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// Named selectors
// ---------------------------------------------------------------------------
export const selectGroups = (s: IngredientState) => s.groups ?? EMPTY_GROUPS
export const selectIngredients = (s: IngredientState) => s.ingredients ?? EMPTY_INGREDIENTS

export const selectIngredientsByGroup = (groupId: string) => (s: IngredientState) =>
  s.ingredients.filter((i) => i.group_id === groupId)

export const selectSubIngredientsByIngredient = (ingredientId: string) => (s: IngredientState) =>
  s.subIngredients.filter((s2) => s2.ingredient_id === ingredientId)

export const useIngredientsByGroup = (groupId: string) =>
  useIngredientStore(useShallow((s) => s.ingredients.filter((i) => i.group_id === groupId)))

export const useSubIngredientsByIngredient = (ingredientId: string) =>
  useIngredientStore(useShallow((s) => s.subIngredients.filter((s2) => s2.ingredient_id === ingredientId)))
