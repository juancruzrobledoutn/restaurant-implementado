/**
 * allergenStore — tenant-scoped allergen management.
 *
 * Includes: allergens, cross-reactions, product-allergen links.
 * Optimistic updates with rollback on all mutate actions.
 *
 * Skill: zustand-store-pattern, dashboard-crud-page
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/utils/constants'
import { fetchAPI } from '@/services/api'
import { toast } from '@/stores/toastStore'
import { logger, handleError } from '@/utils/logger'
import type {
  Allergen,
  AllergenFormData,
  ProductAllergen,
  AllergenCrossReaction,
} from '@/types/menu'

// ---------------------------------------------------------------------------
// Stable empty fallbacks
// ---------------------------------------------------------------------------
const EMPTY_ALLERGENS: Allergen[] = []
const EMPTY_PRODUCT_ALLERGENS: ProductAllergen[] = []
const EMPTY_CROSS_REACTIONS: AllergenCrossReaction[] = []

// ---------------------------------------------------------------------------
// Backend response shape (IDs are numbers)
// ---------------------------------------------------------------------------
interface BackendAllergen {
  id: number
  tenant_id: number
  name: string
  icon?: string
  description?: string
  is_mandatory: boolean
  severity: string
  is_active: boolean
  created_at?: string
  updated_at?: string
}

function toAllergen(b: BackendAllergen): Allergen {
  return {
    ...b,
    id: String(b.id),
    tenant_id: String(b.tenant_id),
    severity: b.severity as Allergen['severity'],
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
interface AllergenState {
  items: Allergen[]
  productAllergens: ProductAllergen[]
  crossReactions: AllergenCrossReaction[]
  isLoading: boolean
  error: string | null
  pendingTempIds: Set<string>

  // CRUD actions
  fetchAsync: () => Promise<void>
  createAsync: (data: AllergenFormData) => Promise<Allergen>
  updateAsync: (id: string, data: AllergenFormData) => Promise<void>
  deleteAsync: (id: string) => Promise<void>

  // Cross-reaction actions
  linkCrossReactionAsync: (allergenId: string, relatedId: string) => Promise<void>
  unlinkCrossReactionAsync: (allergenId: string, relatedId: string) => Promise<void>

  // WS event handlers
  applyWSCreated: (data: Record<string, unknown>) => void
  applyWSUpdated: (data: Record<string, unknown>) => void
  applyWSDeleted: (id: string) => void
}

export const useAllergenStore = create<AllergenState>()(
  persist(
    (set, get) => ({
      items: EMPTY_ALLERGENS,
      productAllergens: EMPTY_PRODUCT_ALLERGENS,
      crossReactions: EMPTY_CROSS_REACTIONS,
      isLoading: false,
      error: null,
      pendingTempIds: new Set<string>(),

      // ------------------------------------------------------------------
      // Fetch
      // ------------------------------------------------------------------
      fetchAsync: async () => {
        set({ isLoading: true, error: null })
        try {
          const data = await fetchAPI<BackendAllergen[]>('/api/admin/allergens')
          set({ items: data.map(toAllergen), isLoading: false })
        } catch (err) {
          const message = handleError(err, 'allergenStore.fetchAsync')
          set({ isLoading: false, error: message })
        }
      },

      // ------------------------------------------------------------------
      // Create (optimistic)
      // ------------------------------------------------------------------
      createAsync: async (data) => {
        const tempId = `temp-${Date.now()}`
        const optimistic: Allergen = {
          ...data,
          id: tempId,
          tenant_id: '',
          created_at: new Date().toISOString(),
          is_active: true,
          _optimistic: true,
        }

        set((s) => ({
          items: [...s.items, optimistic],
          pendingTempIds: new Set([...s.pendingTempIds, tempId]),
        }))

        try {
          const created = await fetchAPI<BackendAllergen>('/api/admin/allergens', {
            method: 'POST',
            body: data,
          })
          const real = toAllergen(created)
          set((s) => ({
            items: s.items.map((i) => (i.id === tempId ? real : i)),
            pendingTempIds: (() => {
              const next = new Set(s.pendingTempIds)
              next.delete(tempId)
              return next
            })(),
          }))
          toast.success('Alérgeno creado correctamente')
          return real
        } catch (err) {
          set((s) => ({
            items: s.items.filter((i) => i.id !== tempId),
            pendingTempIds: (() => {
              const next = new Set(s.pendingTempIds)
              next.delete(tempId)
              return next
            })(),
            error: handleError(err, 'allergenStore.createAsync'),
          }))
          toast.error('Error al crear el alérgeno')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // Update (optimistic)
      // ------------------------------------------------------------------
      updateAsync: async (id, data) => {
        const previous = get().items
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, ...data } : i)),
        }))
        try {
          const updated = await fetchAPI<BackendAllergen>(`/api/admin/allergens/${id}`, {
            method: 'PUT',
            body: data,
          })
          const real = toAllergen(updated)
          set((s) => ({
            items: s.items.map((i) => (i.id === id ? real : i)),
          }))
          toast.success('Alérgeno actualizado correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'allergenStore.updateAsync') })
          toast.error('Error al actualizar el alérgeno')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // Delete (optimistic)
      // ------------------------------------------------------------------
      deleteAsync: async (id) => {
        const previous = get().items
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
        try {
          await fetchAPI(`/api/admin/allergens/${id}`, { method: 'DELETE' })
          toast.success('Alérgeno eliminado correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'allergenStore.deleteAsync') })
          toast.error('Error al eliminar el alérgeno')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // Cross-reactions
      // ------------------------------------------------------------------
      linkCrossReactionAsync: async (allergenId, relatedId) => {
        try {
          await fetchAPI(`/api/admin/allergens/${allergenId}/cross-reactions`, {
            method: 'POST',
            body: { related_allergen_id: relatedId },
          })
          const newReaction: AllergenCrossReaction = {
            id: `${allergenId}-${relatedId}`,
            allergen_id: allergenId,
            related_allergen_id: relatedId,
          }
          set((s) => ({
            crossReactions: [...s.crossReactions, newReaction],
          }))
        } catch (err) {
          handleError(err, 'allergenStore.linkCrossReactionAsync')
          throw err
        }
      },

      unlinkCrossReactionAsync: async (allergenId, relatedId) => {
        const previous = get().crossReactions
        set((s) => ({
          crossReactions: s.crossReactions.filter(
            (r) =>
              !(r.allergen_id === allergenId && r.related_allergen_id === relatedId) &&
              !(r.allergen_id === relatedId && r.related_allergen_id === allergenId),
          ),
        }))
        try {
          await fetchAPI(
            `/api/admin/allergens/${allergenId}/cross-reactions/${relatedId}`,
            { method: 'DELETE' },
          )
        } catch (err) {
          set({ crossReactions: previous })
          handleError(err, 'allergenStore.unlinkCrossReactionAsync')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // WS event handlers
      // ------------------------------------------------------------------
      applyWSCreated: (data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id) return
        // Dedup: skip if already in store
        if (get().items.some((i) => i.id === id)) return
        // Dedup: skip if id matches a pending optimistic we created
        if (get().pendingTempIds.has(id)) return
        const allergen = toAllergen(data as unknown as BackendAllergen)
        set((s) => ({ items: [...s.items, allergen] }))
        logger.debug('allergenStore: WS created', allergen)
      },

      applyWSUpdated: (data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id) return
        const updated = toAllergen(data as unknown as BackendAllergen)
        set((s) => {
          const exists = s.items.some((i) => i.id === id)
          if (!exists) {
            // Apply as insert if not found (edge case: update arrives before fetch)
            return { items: [...s.items, updated] }
          }
          return { items: s.items.map((i) => (i.id === id ? { ...i, ...updated } : i)) }
        })
      },

      applyWSDeleted: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
      },
    }),
    {
      name: STORAGE_KEYS.ALLERGEN,
      version: STORE_VERSIONS.ALLERGEN,
      partialize: (state) => ({
        items: state.items,
        productAllergens: state.productAllergens,
        crossReactions: state.crossReactions,
      }),
      migrate: (persistedState: unknown, _version: number): AllergenState => {
        if (!persistedState || typeof persistedState !== 'object') {
          return {
            items: EMPTY_ALLERGENS,
            productAllergens: EMPTY_PRODUCT_ALLERGENS,
            crossReactions: EMPTY_CROSS_REACTIONS,
            isLoading: false,
            error: null,
            pendingTempIds: new Set(),
          } as AllergenState
        }
        const state = persistedState as {
          items?: unknown
          productAllergens?: unknown
          crossReactions?: unknown
        }
        return {
          items: Array.isArray(state.items) ? (state.items as Allergen[]) : EMPTY_ALLERGENS,
          productAllergens: Array.isArray(state.productAllergens)
            ? (state.productAllergens as ProductAllergen[])
            : EMPTY_PRODUCT_ALLERGENS,
          crossReactions: Array.isArray(state.crossReactions)
            ? (state.crossReactions as AllergenCrossReaction[])
            : EMPTY_CROSS_REACTIONS,
          isLoading: false,
          error: null,
          pendingTempIds: new Set(),
        } as AllergenState
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// Named selectors
// ---------------------------------------------------------------------------
export const selectAllergens = (s: AllergenState) => s.items ?? EMPTY_ALLERGENS
export const selectIsLoading = (s: AllergenState) => s.isLoading
export const selectError = (s: AllergenState) => s.error
export const selectAllergenById = (id: string) => (s: AllergenState) =>
  s.items.find((i) => i.id === id) ?? null

export const useAllergenById = (id: string) =>
  useAllergenStore((s) => s.items.find((i) => i.id === id) ?? null)

export const useAllergens = () => useAllergenStore(selectAllergens)

export const useAllergenActions = () =>
  useAllergenStore(
    useShallow((s) => ({
      fetchAsync: s.fetchAsync,
      createAsync: s.createAsync,
      updateAsync: s.updateAsync,
      deleteAsync: s.deleteAsync,
      linkCrossReactionAsync: s.linkCrossReactionAsync,
      unlinkCrossReactionAsync: s.unlinkCrossReactionAsync,
    })),
  )
