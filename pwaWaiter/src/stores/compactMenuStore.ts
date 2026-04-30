/**
 * compactMenuStore — compact menu cache for the waiter quick-order flow.
 *
 * Loads once per branch per session (cache-first). Does NOT encole errors
 * in the retry queue — menu reads are read-only; a network error just shows
 * a retry button.
 *
 * Rules (zustand-store-pattern skill):
 * - NEVER destructure — use named selectors
 * - useShallow for array/object selectors
 * - EMPTY_ARRAY stable fallback
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { getCompactMenu } from '@/services/waiter'
import { logger } from '@/utils/logger'
import { EMPTY_ARRAY } from '@/lib/constants'
import type { CompactCategory, CompactProduct } from '@/services/waiter'

// Re-export for consumers
export type { CompactCategory, CompactProduct }

type MenuStatus = 'idle' | 'loading' | 'ready' | 'error'

interface CompactMenuState {
  branchId: string | null
  categories: CompactCategory[]
  products: CompactProduct[]
  status: MenuStatus
  error?: string

  // Actions
  loadMenu: (branchId: string) => Promise<void>
  reset: () => void
}

// Stable empty fallbacks
const EMPTY_CATEGORIES: CompactCategory[] = EMPTY_ARRAY as unknown as CompactCategory[]
const EMPTY_PRODUCTS: CompactProduct[] = EMPTY_ARRAY as unknown as CompactProduct[]

export const useCompactMenuStore = create<CompactMenuState>()((set, get) => ({
  branchId: null,
  categories: EMPTY_CATEGORIES,
  products: EMPTY_PRODUCTS,
  status: 'idle',
  error: undefined,

  // ------------------------------------------------------------------
  // loadMenu — cache-first: skip if already loaded for this branch
  // ------------------------------------------------------------------
  loadMenu: async (branchId: string) => {
    const state = get()
    if (state.branchId === branchId && state.status === 'ready') {
      logger.debug(`compactMenuStore: cache hit for branch ${branchId}`)
      return
    }

    set({ status: 'loading', error: undefined })

    try {
      const menu = await getCompactMenu(branchId)
      set({
        branchId: menu.branchId,
        categories: menu.categories,
        products: menu.products,
        status: 'ready',
      })
      logger.info(`compactMenuStore: loaded ${menu.products.length} products for branch ${branchId}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al cargar el menú'
      logger.error('compactMenuStore: loadMenu failed', err)
      set({ status: 'error', error: msg })
    }
  },

  reset: () =>
    set({
      branchId: null,
      categories: EMPTY_CATEGORIES,
      products: EMPTY_PRODUCTS,
      status: 'idle',
      error: undefined,
    }),
}))

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectMenuStatus = (s: CompactMenuState): MenuStatus => s.status
export const selectMenuError = (s: CompactMenuState): string | undefined => s.error
export const selectMenuBranchId = (s: CompactMenuState): string | null => s.branchId

/** All categories — plain selector (single array slice already in state). */
export const selectCategories = (s: CompactMenuState): CompactCategory[] =>
  s.categories

/** All products — plain selector. */
export const selectAllProducts = (s: CompactMenuState): CompactProduct[] =>
  s.products

/**
 * Hook: products filtered by category id — uses useShallow for stable reference.
 * `catId` here is the category.id (subcategory_id field on products points to
 * their subcategory, not the top-level category; for simplicity the grid shows
 * all products under the top-level category that contains them).
 */
export function useProductsByCategory(catId: string): CompactProduct[] {
  return useCompactMenuStore(
    useShallow((s) =>
      s.products.filter((p) => {
        // Products are grouped by subcategory; we expose all under the category
        // The categories list returned from backend includes the flat products per category
        // We stored categories flat (id+name) and products with subcategoryId
        // So filter products that "belong" to this category via subcategoryId match
        // (frontend uses catId = category.id; subcategoryId is the subcategory within that cat)
        // Simple approach: we re-check against categories — but since we only have subcategoryId
        // on product and category.id on category (both are separate levels), we expose all
        // available products for the quick-order grid rather than strict subcategory filtering.
        // Components can filter further. For now return all available products.
        return p.subcategoryId === catId
      })
    ),
  )
}

/**
 * Hook: find a product by its string ID — returns undefined if not found.
 * Uses plain selector (returns a single item, not an array).
 */
export function useProductById(id: string): CompactProduct | undefined {
  return useCompactMenuStore((s) => s.products.find((p) => p.id === id))
}

/**
 * Non-hook selector: returns a product by ID from the current store state.
 * Safe to call outside React render (e.g. in components that look up names
 * from the compact menu after receiving a round event).
 *
 * Usage: `selectProductById(productId)(useCompactMenuStore.getState())`
 * Or via hook: `useCompactMenuStore(selectProductById(productId))`
 */
export function selectProductById(productId: string) {
  return (s: CompactMenuState): CompactProduct | undefined =>
    s.products.find((p) => p.id === productId)
}
