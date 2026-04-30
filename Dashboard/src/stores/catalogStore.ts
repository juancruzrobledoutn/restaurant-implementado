/**
 * catalogStore — tenant-scoped catalog data (read-only lookups).
 *
 * Currently holds:
 *   - promotion_types: PromotionType[] — added for C-27
 *
 * Design decisions:
 * - No persist() — catalogs are cheap to re-fetch on each app load.
 * - fetchPromotionTypesAsync is idempotent: skips the request if items already loaded.
 * - IDs converted number → string at the API boundary.
 *
 * Skill: zustand-store-pattern
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { fetchAPI } from '@/services/api'
import { handleError } from '@/utils/logger'
import type { PromotionType } from '@/types/menu'

const EMPTY_PROMOTION_TYPES: PromotionType[] = []

interface BackendPromotionType {
  id: number
  name: string
}

function toPromotionType(b: BackendPromotionType): PromotionType {
  return {
    id: String(b.id),
    name: b.name,
  }
}

interface CatalogState {
  promotion_types: PromotionType[]
  isLoadingTypes: boolean
  errorTypes: string | null

  fetchPromotionTypesAsync: () => Promise<void>
}

export const useCatalogStore = create<CatalogState>()((set, get) => ({
  promotion_types: EMPTY_PROMOTION_TYPES,
  isLoadingTypes: false,
  errorTypes: null,

  fetchPromotionTypesAsync: async () => {
    // Idempotent: skip if already loaded
    if (get().promotion_types.length > 0) return

    set({ isLoadingTypes: true, errorTypes: null })
    try {
      const data = await fetchAPI<BackendPromotionType[]>('/api/admin/catalogs/promotion-types')
      set({ promotion_types: data.map(toPromotionType), isLoadingTypes: false })
    } catch (err) {
      set({
        isLoadingTypes: false,
        errorTypes: handleError(err, 'catalogStore.fetchPromotionTypesAsync'),
      })
    }
  },
}))

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectPromotionTypes = (s: CatalogState) => s.promotion_types
export const selectIsLoadingTypes = (s: CatalogState) => s.isLoadingTypes
export const selectErrorTypes = (s: CatalogState) => s.errorTypes

/** Returns a single PromotionType by id, or null if not found. */
export const usePromotionTypeById = (id: string | null) =>
  useCatalogStore((s) =>
    id ? (s.promotion_types.find((t) => t.id === id) ?? null) : null,
  )

/** Returns all promotion types (stable reference via shallow). */
export const usePromotionTypes = () =>
  useCatalogStore(useShallow((s) => s.promotion_types))
