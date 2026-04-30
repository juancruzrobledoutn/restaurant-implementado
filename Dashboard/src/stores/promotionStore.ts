/**
 * promotionStore — tenant-scoped promotion management with optimistic updates.
 *
 * Design (design.md D1, D2, D9, D11):
 * - Tenant-scoped (not branch-scoped): one fetch loads all promotions for the tenant.
 *   Client-side filtering by branch/status/validity handled in selectors.
 * - Optimistic updates with automatic rollback on ALL mutations.
 * - WS deduplication via idempotent applyWSCreated (skip if id already exists).
 * - persist() with STORE_VERSIONS.PROMOTION + strict type-guard migrate().
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
import type { Promotion, PromotionFormData } from '@/types/menu'

// ---------------------------------------------------------------------------
// Stable fallbacks
// ---------------------------------------------------------------------------

const EMPTY_PROMOTIONS: Promotion[] = []

// ---------------------------------------------------------------------------
// Backend ↔ Frontend type boundary
// ---------------------------------------------------------------------------

interface BackendPromotion {
  id: number
  tenant_id: number
  name: string
  description?: string
  price: number
  start_date: string
  start_time: string
  end_date: string
  end_time: string
  promotion_type_id?: number | null
  is_active: boolean
  created_at: string
  updated_at: string
  branches: Array<{ branch_id: number; branch_name: string }>
  items: Array<{ product_id: number; product_name: string }>
}

function toPromotion(b: BackendPromotion): Promotion {
  return {
    id: String(b.id),
    tenant_id: String(b.tenant_id),
    name: b.name,
    description: b.description,
    price: b.price,
    start_date: b.start_date,
    start_time: b.start_time,
    end_date: b.end_date,
    end_time: b.end_time,
    promotion_type_id: b.promotion_type_id != null ? String(b.promotion_type_id) : undefined,
    is_active: b.is_active,
    created_at: b.created_at,
    updated_at: b.updated_at,
    branches: b.branches.map((br) => ({
      branch_id: String(br.branch_id),
      branch_name: br.branch_name,
    })),
    items: b.items.map((it) => ({
      product_id: String(it.product_id),
      product_name: it.product_name,
    })),
  }
}

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

interface PromotionState {
  items: Promotion[]
  isLoading: boolean
  error: string | null
  pendingTempIds: Set<string>

  // CRUD mutations — all optimistic with rollback
  fetchAsync: () => Promise<void>
  createAsync: (data: PromotionFormData) => Promise<Promotion>
  updateAsync: (id: string, data: Partial<PromotionFormData>) => Promise<void>
  deleteAsync: (id: string) => Promise<void>
  toggleActiveAsync: (id: string) => Promise<void>

  // Branch/product linking — optimistic
  linkBranchAsync: (promotionId: string, branchId: string) => Promise<void>
  unlinkBranchAsync: (promotionId: string, branchId: string) => Promise<void>
  linkProductAsync: (promotionId: string, productId: string, productName?: string) => Promise<void>
  unlinkProductAsync: (promotionId: string, productId: string) => Promise<void>

  // WebSocket sync — called by useMenuWebSocketSync
  applyWSCreated: (promotion: Promotion) => void
  applyWSUpdated: (promotion: Promotion) => void
  applyWSDeleted: (id: string) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePromotionStore = create<PromotionState>()(
  persist(
    (set, get) => ({
      items: EMPTY_PROMOTIONS,
      isLoading: false,
      error: null,
      pendingTempIds: new Set(),

      // -----------------------------------------------------------------------
      // fetchAsync
      // -----------------------------------------------------------------------
      fetchAsync: async () => {
        set({ isLoading: true, error: null })
        try {
          const data = await fetchAPI<BackendPromotion[]>('/api/admin/promotions?limit=200&offset=0')
          set({ items: data.map(toPromotion), isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'promotionStore.fetchAsync') })
        }
      },

      // -----------------------------------------------------------------------
      // createAsync — optimistic insert with tempId, replace on success
      // -----------------------------------------------------------------------
      createAsync: async (data) => {
        const tempId = crypto.randomUUID()
        const now = new Date().toISOString()

        const optimistic: Promotion = {
          id: tempId,
          tenant_id: '',
          name: data.name,
          description: data.description || undefined,
          price: data.price,
          start_date: data.start_date,
          start_time: data.start_time,
          end_date: data.end_date,
          end_time: data.end_time,
          promotion_type_id: data.promotion_type_id ?? undefined,
          is_active: data.is_active,
          created_at: now,
          updated_at: now,
          branches: [],
          items: [],
          _optimistic: true,
        }

        set((state) => ({
          items: [...state.items, optimistic],
          pendingTempIds: new Set([...state.pendingTempIds, tempId]),
        }))

        try {
          const created = await fetchAPI<BackendPromotion>('/api/admin/promotions', {
            method: 'POST',
            body: JSON.stringify({
              name: data.name,
              description: data.description || undefined,
              price: data.price,
              start_date: data.start_date,
              start_time: data.start_time,
              end_date: data.end_date,
              end_time: data.end_time,
              promotion_type_id: data.promotion_type_id ? Number(data.promotion_type_id) : null,
              branch_ids: data.branch_ids.map(Number),
              product_ids: data.product_ids.map(Number),
              is_active: data.is_active,
            }),
          })

          const real = toPromotion(created)

          set((state) => {
            const pendingTempIds = new Set(state.pendingTempIds)
            pendingTempIds.delete(tempId)
            return {
              items: state.items.map((p) => (p.id === tempId ? real : p)),
              pendingTempIds,
            }
          })

          return real
        } catch (err) {
          // Rollback: remove the optimistic item
          set((state) => {
            const pendingTempIds = new Set(state.pendingTempIds)
            pendingTempIds.delete(tempId)
            return {
              items: state.items.filter((p) => p.id !== tempId),
              pendingTempIds,
              error: handleError(err, 'promotionStore.createAsync'),
            }
          })
          throw err
        }
      },

      // -----------------------------------------------------------------------
      // updateAsync — optimistic merge, rollback on failure
      // -----------------------------------------------------------------------
      updateAsync: async (id, data) => {
        const previous = get().items
        const target = previous.find((p) => p.id === id)
        if (!target) return

        const merged: Promotion = {
          ...target,
          ...data,
          promotion_type_id:
            'promotion_type_id' in data
              ? (data.promotion_type_id ?? undefined)
              : target.promotion_type_id,
        }

        set({ items: previous.map((p) => (p.id === id ? merged : p)) })

        try {
          const body: Record<string, unknown> = {}
          if (data.name !== undefined) body.name = data.name
          if (data.description !== undefined) body.description = data.description
          if (data.price !== undefined) body.price = data.price
          if (data.start_date !== undefined) body.start_date = data.start_date
          if (data.start_time !== undefined) body.start_time = data.start_time
          if (data.end_date !== undefined) body.end_date = data.end_date
          if (data.end_time !== undefined) body.end_time = data.end_time
          if (data.promotion_type_id !== undefined) {
            body.promotion_type_id = data.promotion_type_id ? Number(data.promotion_type_id) : null
          }
          if (data.is_active !== undefined) body.is_active = data.is_active

          const updated = await fetchAPI<BackendPromotion>(`/api/admin/promotions/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })

          set((state) => ({
            items: state.items.map((p) => (p.id === id ? toPromotion(updated) : p)),
          }))
        } catch (err) {
          set({ items: previous, error: handleError(err, 'promotionStore.updateAsync') })
          throw err
        }
      },

      // -----------------------------------------------------------------------
      // deleteAsync — optimistic remove, rollback with position restore
      // -----------------------------------------------------------------------
      deleteAsync: async (id) => {
        const previous = get().items
        const index = previous.findIndex((p) => p.id === id)
        if (index === -1) return

        set({ items: previous.filter((p) => p.id !== id) })

        try {
          await fetchAPI(`/api/admin/promotions/${id}`, { method: 'DELETE' })
        } catch (err) {
          // Rollback: re-insert at original position
          set((state) => {
            const restored = [...state.items]
            restored.splice(index, 0, previous[index]!)
            return { items: restored, error: handleError(err, 'promotionStore.deleteAsync') }
          })
          throw err
        }
      },

      // -----------------------------------------------------------------------
      // toggleActiveAsync — optimistic flip, rollback on failure (design.md D2)
      // -----------------------------------------------------------------------
      toggleActiveAsync: async (id) => {
        const previous = get().items
        const target = previous.find((p) => p.id === id)
        if (!target) return

        // Optimistic flip
        set({
          items: previous.map((p) =>
            p.id === id ? { ...p, is_active: !p.is_active } : p,
          ),
        })

        try {
          const updated = await fetchAPI<BackendPromotion>(`/api/admin/promotions/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: !target.is_active }),
          })
          set((state) => ({
            items: state.items.map((p) => (p.id === id ? toPromotion(updated) : p)),
          }))
        } catch (err) {
          // Rollback to previous state
          set({ items: previous, error: handleError(err, 'promotionStore.toggleActiveAsync') })
          toast.error('promotions.toggleFailed')
          throw err
        }
      },

      // -----------------------------------------------------------------------
      // linkBranchAsync — optimistic append, rollback on failure
      // -----------------------------------------------------------------------
      linkBranchAsync: async (promotionId, branchId) => {
        const previous = get().items
        const target = previous.find((p) => p.id === promotionId)
        if (!target) return

        // Optimistic: add branch stub (branch_name unknown until server responds)
        const optimisticBranch = { branch_id: branchId, branch_name: '' }
        set({
          items: previous.map((p) =>
            p.id === promotionId
              ? { ...p, branches: [...p.branches, optimisticBranch] }
              : p,
          ),
        })

        try {
          const updated = await fetchAPI<BackendPromotion>(
            `/api/admin/promotions/${promotionId}/branches?branch_id=${branchId}`,
            { method: 'POST' },
          )
          set((state) => ({
            items: state.items.map((p) => (p.id === promotionId ? toPromotion(updated) : p)),
          }))
        } catch (err) {
          set({ items: previous, error: handleError(err, 'promotionStore.linkBranchAsync') })
          throw err
        }
      },

      // -----------------------------------------------------------------------
      // unlinkBranchAsync — optimistic filter, rollback on failure
      // -----------------------------------------------------------------------
      unlinkBranchAsync: async (promotionId, branchId) => {
        const previous = get().items
        const target = previous.find((p) => p.id === promotionId)
        if (!target) return

        set({
          items: previous.map((p) =>
            p.id === promotionId
              ? { ...p, branches: p.branches.filter((b) => b.branch_id !== branchId) }
              : p,
          ),
        })

        try {
          await fetchAPI(`/api/admin/promotions/${promotionId}/branches/${branchId}`, {
            method: 'DELETE',
          })
        } catch (err) {
          set({ items: previous, error: handleError(err, 'promotionStore.unlinkBranchAsync') })
          throw err
        }
      },

      // -----------------------------------------------------------------------
      // linkProductAsync — optimistic append, rollback on failure
      // -----------------------------------------------------------------------
      linkProductAsync: async (promotionId, productId, productName = '') => {
        const previous = get().items
        const target = previous.find((p) => p.id === promotionId)
        if (!target) return

        const optimisticItem = { product_id: productId, product_name: productName }
        set({
          items: previous.map((p) =>
            p.id === promotionId
              ? { ...p, items: [...p.items, optimisticItem] }
              : p,
          ),
        })

        try {
          const updated = await fetchAPI<BackendPromotion>(
            `/api/admin/promotions/${promotionId}/products?product_id=${productId}`,
            { method: 'POST' },
          )
          set((state) => ({
            items: state.items.map((p) => (p.id === promotionId ? toPromotion(updated) : p)),
          }))
        } catch (err) {
          set({ items: previous, error: handleError(err, 'promotionStore.linkProductAsync') })
          throw err
        }
      },

      // -----------------------------------------------------------------------
      // unlinkProductAsync — optimistic filter, rollback on failure
      // -----------------------------------------------------------------------
      unlinkProductAsync: async (promotionId, productId) => {
        const previous = get().items
        const target = previous.find((p) => p.id === promotionId)
        if (!target) return

        set({
          items: previous.map((p) =>
            p.id === promotionId
              ? { ...p, items: p.items.filter((i) => i.product_id !== productId) }
              : p,
          ),
        })

        try {
          await fetchAPI(`/api/admin/promotions/${promotionId}/products/${productId}`, {
            method: 'DELETE',
          })
        } catch (err) {
          set({ items: previous, error: handleError(err, 'promotionStore.unlinkProductAsync') })
          throw err
        }
      },

      // -----------------------------------------------------------------------
      // WS sync actions (called by useMenuWebSocketSync)
      // -----------------------------------------------------------------------
      applyWSCreated: (promotion) => {
        set((state) => {
          // Dedup by id — skip if already exists (optimistic already inserted it)
          if (state.items.some((p) => p.id === promotion.id)) return state
          return { items: [...state.items, promotion] }
        })
      },

      applyWSUpdated: (promotion) => {
        set((state) => ({
          items: state.items.map((p) => (p.id === promotion.id ? promotion : p)),
        }))
      },

      applyWSDeleted: (id) => {
        set((state) => ({ items: state.items.filter((p) => p.id !== id) }))
      },
    }),
    {
      name: STORAGE_KEYS.PROMOTION,
      version: STORE_VERSIONS.PROMOTION,
      migrate: (persistedState: unknown, _version: number) => {
        // Type guard — if shape is invalid, return safe defaults
        if (!persistedState || typeof persistedState !== 'object') {
          return {
            items: [],
            isLoading: false,
            error: null,
            pendingTempIds: new Set(),
          }
        }

        const state = persistedState as { items?: unknown }

        if (!Array.isArray(state.items)) {
          return {
            items: [],
            isLoading: false,
            error: null,
            pendingTempIds: new Set(),
          }
        }

        // Version 1 — no migration needed yet
        // When version bumps to 2, add: if (_version < 2) { ... }
        return {
          items: state.items as Promotion[],
          isLoading: false,
          error: null,
          pendingTempIds: new Set(),
        } as PromotionState
      },
      // Serialize Set for localStorage (JSON doesn't handle Set natively)
      // pendingTempIds is excluded — it always resets to empty Set on reload
      partialize: (state): PromotionState => ({
        ...state,
        items: state.items,
        isLoading: false,
        error: null,
        pendingTempIds: new Set<string>(),
      }),
    },
  ),
)

// ---------------------------------------------------------------------------
// Selectors (plain — for primitive or already-stable state slices)
// ---------------------------------------------------------------------------

export const selectPromotions = (s: PromotionState) => s.items
export const selectIsLoading = (s: PromotionState) => s.isLoading
export const selectError = (s: PromotionState) => s.error

/** Returns a promotion by id, or null if not found. */
export const selectPromotionById =
  (id: string) =>
  (s: PromotionState): Promotion | null =>
    s.items.find((p) => p.id === id) ?? null

// ---------------------------------------------------------------------------
// Selector hooks (with useShallow for filtered/derived collections)
// ---------------------------------------------------------------------------

/** Returns all promotions where is_active=true. Stable reference via useShallow. */
export const useActivePromotions = () =>
  usePromotionStore(useShallow((s) => s.items.filter((p) => p.is_active)))

/** Returns promotions linked to a specific branch. useShallow for stable ref. */
export const usePromotionsForBranch = (branchId: string | null) =>
  usePromotionStore(
    useShallow((s) =>
      branchId
        ? s.items.filter((p) => p.branches.some((b) => b.branch_id === branchId))
        : s.items,
    ),
  )

/** Grouped action hooks — useShallow mandatory for object return. */
export const usePromotionActions = () =>
  usePromotionStore(
    useShallow((s) => ({
      fetchAsync: s.fetchAsync,
      createAsync: s.createAsync,
      updateAsync: s.updateAsync,
      deleteAsync: s.deleteAsync,
      toggleActiveAsync: s.toggleActiveAsync,
    })),
  )
