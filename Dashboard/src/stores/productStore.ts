/**
 * productStore — branch-scoped product + BranchProduct + ProductAllergen management.
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
import type {
  Product,
  ProductFormData,
  BranchProduct,
  BranchProductFormData,
  ProductAllergen,
  ProductAllergenFormData,
} from '@/types/menu'

const EMPTY_PRODUCTS: Product[] = []
const EMPTY_BRANCH_PRODUCTS: BranchProduct[] = []
const EMPTY_PRODUCT_ALLERGENS: ProductAllergen[] = []

// ---------------------------------------------------------------------------
// Backend response shapes (IDs are numbers)
// ---------------------------------------------------------------------------

interface BackendProduct {
  id: number
  tenant_id: number
  branch_id: number
  subcategory_id: number
  name: string
  description: string
  price_cents: number
  image?: string
  featured: boolean
  popular: boolean
  is_active: boolean
  created_at?: string
  updated_at?: string
}

interface BackendBranchProduct {
  id: number
  product_id: number
  branch_id: number
  price_override_cents?: number
  is_available: boolean
  created_at?: string
  updated_at?: string
}

interface BackendProductAllergen {
  id: number
  product_id: number
  allergen_id: number
  presence_type: string
  risk_level: string
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function toProduct(b: BackendProduct): Product {
  return {
    ...b,
    id: String(b.id),
    tenant_id: String(b.tenant_id),
    branch_id: String(b.branch_id),
    subcategory_id: String(b.subcategory_id),
  }
}

function toBranchProduct(b: BackendBranchProduct): BranchProduct {
  return {
    ...b,
    id: String(b.id),
    product_id: String(b.product_id),
    branch_id: String(b.branch_id),
  }
}

function toProductAllergen(b: BackendProductAllergen): ProductAllergen {
  return {
    ...b,
    id: String(b.id),
    product_id: String(b.product_id),
    allergen_id: String(b.allergen_id),
    presence_type: b.presence_type as ProductAllergen['presence_type'],
    risk_level: b.risk_level as ProductAllergen['risk_level'],
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ProductState {
  items: Product[]
  branchProducts: BranchProduct[]
  productAllergens: ProductAllergen[]
  isLoading: boolean
  error: string | null
  pendingTempIds: Set<string>

  // Product CRUD
  fetchAsync: () => Promise<void>
  createAsync: (data: ProductFormData) => Promise<Product>
  updateAsync: (id: string, data: ProductFormData) => Promise<void>
  deleteAsync: (id: string) => Promise<void>

  // BranchProduct management
  fetchBranchProductsAsync: (branchId: string) => Promise<void>
  upsertBranchProductAsync: (data: BranchProductFormData) => Promise<void>
  toggleAvailabilityAsync: (branchProductId: string, isAvailable: boolean) => Promise<void>

  // ProductAllergen linking
  fetchProductAllergensAsync: (productId: string) => Promise<void>
  linkAllergenToProductAsync: (productId: string, data: ProductAllergenFormData) => Promise<void>
  unlinkAllergenFromProductAsync: (productId: string, allergenId: string) => Promise<void>

  // WS event handlers
  applyWSCreated: (entity: string, data: Record<string, unknown>) => void
  applyWSUpdated: (entity: string, data: Record<string, unknown>) => void
  applyWSDeleted: (entity: string, id: string) => void
}

export const useProductStore = create<ProductState>()(
  persist(
    (set, get) => ({
      items: EMPTY_PRODUCTS,
      branchProducts: EMPTY_BRANCH_PRODUCTS,
      productAllergens: EMPTY_PRODUCT_ALLERGENS,
      isLoading: false,
      error: null,
      pendingTempIds: new Set(),

      // ------------------------------------------------------------------
      // Fetch products
      // ------------------------------------------------------------------
      fetchAsync: async () => {
        set({ isLoading: true, error: null })
        try {
          const data = await fetchAPI<BackendProduct[]>('/api/admin/products')
          set({ items: data.map(toProduct), isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'productStore.fetchAsync') })
        }
      },

      // ------------------------------------------------------------------
      // Create product (optimistic)
      // ------------------------------------------------------------------
      createAsync: async (data) => {
        const tempId = `temp-${Date.now()}`
        const optimistic: Product = {
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
          const created = await fetchAPI<BackendProduct>('/api/admin/products', {
            method: 'POST',
            body: {
              ...data,
              branch_id: parseInt(data.branch_id, 10),
              subcategory_id: parseInt(data.subcategory_id, 10),
            },
          })
          const real = toProduct(created)
          set((s) => ({
            items: s.items.map((i) => (i.id === tempId ? real : i)),
            pendingTempIds: (() => { const next = new Set(s.pendingTempIds); next.delete(tempId); return next })(),
          }))
          toast.success('Producto creado correctamente')
          return real
        } catch (err) {
          set((s) => ({
            items: s.items.filter((i) => i.id !== tempId),
            pendingTempIds: (() => { const next = new Set(s.pendingTempIds); next.delete(tempId); return next })(),
            error: handleError(err, 'productStore.createAsync'),
          }))
          toast.error('Error al crear el producto')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // Update product (optimistic)
      // ------------------------------------------------------------------
      updateAsync: async (id, data) => {
        const previous = get().items
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...data } : i)) }))
        try {
          const updated = await fetchAPI<BackendProduct>(`/api/admin/products/${id}`, {
            method: 'PUT',
            body: data,
          })
          set((s) => ({ items: s.items.map((i) => (i.id === id ? toProduct(updated) : i)) }))
          toast.success('Producto actualizado correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'productStore.updateAsync') })
          toast.error('Error al actualizar el producto')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // Delete product (optimistic — cascade removes branchProducts + allergens)
      // ------------------------------------------------------------------
      deleteAsync: async (id) => {
        const prevProducts = get().items
        const prevBranchProducts = get().branchProducts
        const prevProductAllergens = get().productAllergens
        set((s) => ({
          items: s.items.filter((i) => i.id !== id),
          branchProducts: s.branchProducts.filter((bp) => bp.product_id !== id),
          productAllergens: s.productAllergens.filter((pa) => pa.product_id !== id),
        }))
        try {
          await fetchAPI(`/api/admin/products/${id}`, { method: 'DELETE' })
          toast.success('Producto eliminado correctamente')
        } catch (err) {
          set({
            items: prevProducts,
            branchProducts: prevBranchProducts,
            productAllergens: prevProductAllergens,
            error: handleError(err, 'productStore.deleteAsync'),
          })
          toast.error('Error al eliminar el producto')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // Fetch branch products for a given branch
      // ------------------------------------------------------------------
      fetchBranchProductsAsync: async (branchId) => {
        try {
          const data = await fetchAPI<BackendBranchProduct[]>(
            `/api/admin/branches/${branchId}/products`,
          )
          const incoming = data.map(toBranchProduct)
          set((s) => ({
            // Replace all branchProducts for this branch, keep others
            branchProducts: [
              ...s.branchProducts.filter((bp) => bp.branch_id !== branchId),
              ...incoming,
            ],
          }))
        } catch (err) {
          handleError(err, 'productStore.fetchBranchProductsAsync')
        }
      },

      // ------------------------------------------------------------------
      // Upsert branch product (create or update availability + price override)
      // ------------------------------------------------------------------
      upsertBranchProductAsync: async (data) => {
        const previous = get().branchProducts
        // Optimistic: update if exists, insert temp otherwise
        const existing = get().branchProducts.find(
          (bp) => bp.product_id === data.product_id && bp.branch_id === data.branch_id,
        )
        if (existing) {
          set((s) => ({
            branchProducts: s.branchProducts.map((bp) =>
              bp.id === existing.id ? { ...bp, ...data } : bp,
            ),
          }))
        } else {
          const tempId = `temp-${Date.now()}`
          set((s) => ({
            branchProducts: [
              ...s.branchProducts,
              { ...data, id: tempId, _optimistic: true } as BranchProduct,
            ],
          }))
        }
        try {
          const result = await fetchAPI<BackendBranchProduct>(
            `/api/admin/products/${data.product_id}/branch-products`,
            { method: 'POST', body: data },
          )
          const real = toBranchProduct(result)
          set((s) => ({
            branchProducts: s.branchProducts.some((bp) => bp.id === real.id)
              ? s.branchProducts.map((bp) => (bp.id === real.id ? real : bp))
              : s.branchProducts.map((bp) =>
                  bp.product_id === data.product_id && bp.branch_id === data.branch_id && bp._optimistic
                    ? real
                    : bp,
                ),
          }))
          toast.success('Disponibilidad actualizada correctamente')
        } catch (err) {
          set({ branchProducts: previous, error: handleError(err, 'productStore.upsertBranchProductAsync') })
          toast.error('Error al actualizar la disponibilidad')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // Toggle availability (optimistic)
      // ------------------------------------------------------------------
      toggleAvailabilityAsync: async (branchProductId, isAvailable) => {
        const previous = get().branchProducts
        set((s) => ({
          branchProducts: s.branchProducts.map((bp) =>
            bp.id === branchProductId ? { ...bp, is_available: isAvailable } : bp,
          ),
        }))
        try {
          const updated = await fetchAPI<BackendBranchProduct>(
            `/api/admin/branch-products/${branchProductId}`,
            { method: 'PATCH', body: { is_available: isAvailable } },
          )
          set((s) => ({
            branchProducts: s.branchProducts.map((bp) =>
              bp.id === branchProductId ? toBranchProduct(updated) : bp,
            ),
          }))
        } catch (err) {
          set({ branchProducts: previous, error: handleError(err, 'productStore.toggleAvailabilityAsync') })
          toast.error('Error al cambiar la disponibilidad')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // Fetch product allergens
      // ------------------------------------------------------------------
      fetchProductAllergensAsync: async (productId) => {
        try {
          const data = await fetchAPI<BackendProductAllergen[]>(
            `/api/admin/products/${productId}/allergens`,
          )
          const incoming = data.map(toProductAllergen)
          set((s) => ({
            productAllergens: [
              ...s.productAllergens.filter((pa) => pa.product_id !== productId),
              ...incoming,
            ],
          }))
        } catch (err) {
          handleError(err, 'productStore.fetchProductAllergensAsync')
        }
      },

      // ------------------------------------------------------------------
      // Link allergen to product
      // ------------------------------------------------------------------
      linkAllergenToProductAsync: async (productId, data) => {
        try {
          const created = await fetchAPI<BackendProductAllergen>(
            `/api/admin/products/${productId}/allergens`,
            { method: 'POST', body: { ...data, allergen_id: parseInt(data.allergen_id, 10) } },
          )
          const real = toProductAllergen(created)
          set((s) => ({
            productAllergens: s.productAllergens.some((pa) => pa.id === real.id)
              ? s.productAllergens
              : [...s.productAllergens, real],
          }))
          toast.success('Alérgeno vinculado correctamente')
        } catch (err) {
          handleError(err, 'productStore.linkAllergenToProductAsync')
          toast.error('Error al vincular el alérgeno')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // Unlink allergen from product
      // ------------------------------------------------------------------
      unlinkAllergenFromProductAsync: async (productId, allergenId) => {
        const previous = get().productAllergens
        set((s) => ({
          productAllergens: s.productAllergens.filter(
            (pa) => !(pa.product_id === productId && pa.allergen_id === allergenId),
          ),
        }))
        try {
          await fetchAPI(`/api/admin/products/${productId}/allergens/${allergenId}`, {
            method: 'DELETE',
          })
          toast.success('Alérgeno desvinculado correctamente')
        } catch (err) {
          set({ productAllergens: previous, error: handleError(err, 'productStore.unlinkAllergenFromProductAsync') })
          toast.error('Error al desvincular el alérgeno')
          throw err
        }
      },

      // ------------------------------------------------------------------
      // WS event handlers
      // ------------------------------------------------------------------
      applyWSCreated: (entity, data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id) return
        if (entity === 'product') {
          if (get().items.some((i) => i.id === id)) return
          if (get().pendingTempIds.has(id)) return
          set((s) => ({ items: [...s.items, toProduct(data as unknown as BackendProduct)] }))
        } else if (entity === 'branch_product') {
          if (get().branchProducts.some((bp) => bp.id === id)) return
          set((s) => ({
            branchProducts: [...s.branchProducts, toBranchProduct(data as unknown as BackendBranchProduct)],
          }))
        } else if (entity === 'product_allergen') {
          if (get().productAllergens.some((pa) => pa.id === id)) return
          set((s) => ({
            productAllergens: [
              ...s.productAllergens,
              toProductAllergen(data as unknown as BackendProductAllergen),
            ],
          }))
        }
      },

      applyWSUpdated: (entity, data) => {
        const id = String((data as { id?: number }).id ?? '')
        if (!id) return
        if (entity === 'product') {
          const updated = toProduct(data as unknown as BackendProduct)
          set((s) => ({
            items: s.items.some((i) => i.id === id)
              ? s.items.map((i) => (i.id === id ? { ...i, ...updated } : i))
              : [...s.items, updated],
          }))
        } else if (entity === 'branch_product') {
          const updated = toBranchProduct(data as unknown as BackendBranchProduct)
          set((s) => ({
            branchProducts: s.branchProducts.some((bp) => bp.id === id)
              ? s.branchProducts.map((bp) => (bp.id === id ? { ...bp, ...updated } : bp))
              : [...s.branchProducts, updated],
          }))
        }
      },

      applyWSDeleted: (entity, id) => {
        if (entity === 'product') {
          set((s) => ({
            items: s.items.filter((i) => i.id !== id),
            branchProducts: s.branchProducts.filter((bp) => bp.product_id !== id),
            productAllergens: s.productAllergens.filter((pa) => pa.product_id !== id),
          }))
        } else if (entity === 'branch_product') {
          set((s) => ({ branchProducts: s.branchProducts.filter((bp) => bp.id !== id) }))
        } else if (entity === 'product_allergen') {
          set((s) => ({ productAllergens: s.productAllergens.filter((pa) => pa.id !== id) }))
        }
      },
    }),
    {
      name: STORAGE_KEYS.PRODUCT,
      version: STORE_VERSIONS.PRODUCT,
      partialize: (state) => ({
        items: state.items,
        branchProducts: state.branchProducts,
        productAllergens: state.productAllergens,
      }),
      migrate: (persistedState: unknown): ProductState => {
        if (!persistedState || typeof persistedState !== 'object') {
          return {
            items: EMPTY_PRODUCTS,
            branchProducts: EMPTY_BRANCH_PRODUCTS,
            productAllergens: EMPTY_PRODUCT_ALLERGENS,
            isLoading: false,
            error: null,
            pendingTempIds: new Set(),
          } as ProductState
        }
        const state = persistedState as {
          items?: unknown
          branchProducts?: unknown
          productAllergens?: unknown
        }
        return {
          items: Array.isArray(state.items) ? (state.items as Product[]) : EMPTY_PRODUCTS,
          branchProducts: Array.isArray(state.branchProducts)
            ? (state.branchProducts as BranchProduct[])
            : EMPTY_BRANCH_PRODUCTS,
          productAllergens: Array.isArray(state.productAllergens)
            ? (state.productAllergens as ProductAllergen[])
            : EMPTY_PRODUCT_ALLERGENS,
          isLoading: false,
          error: null,
          pendingTempIds: new Set(),
        } as ProductState
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// Named selectors
// ---------------------------------------------------------------------------
export const selectProducts = (s: ProductState) => s.items ?? EMPTY_PRODUCTS
export const selectBranchProducts = (s: ProductState) => s.branchProducts ?? EMPTY_BRANCH_PRODUCTS
export const selectProductAllergens = (s: ProductState) => s.productAllergens ?? EMPTY_PRODUCT_ALLERGENS
export const selectProductIsLoading = (s: ProductState) => s.isLoading
export const selectProductError = (s: ProductState) => s.error

export const selectProductsBySubcategory = (subcategoryId: string) => (s: ProductState) =>
  s.items.filter((p) => p.subcategory_id === subcategoryId)

export const selectBranchProductsByProduct = (productId: string) => (s: ProductState) =>
  s.branchProducts.filter((bp) => bp.product_id === productId)

export const selectAllergensForProduct = (productId: string) => (s: ProductState) =>
  s.productAllergens.filter((pa) => pa.product_id === productId)

export const useProductsBySubcategory = (subcategoryId: string) =>
  useProductStore(useShallow((s) => s.items.filter((p) => p.subcategory_id === subcategoryId)))

export const useBranchProductsByProduct = (productId: string) =>
  useProductStore(useShallow((s) => s.branchProducts.filter((bp) => bp.product_id === productId)))

export const useAllergensForProduct = (productId: string) =>
  useProductStore(useShallow((s) => s.productAllergens.filter((pa) => pa.product_id === productId)))

export const useProductActions = () =>
  useProductStore(
    useShallow((s) => ({
      fetchAsync: s.fetchAsync,
      createAsync: s.createAsync,
      updateAsync: s.updateAsync,
      deleteAsync: s.deleteAsync,
      upsertBranchProductAsync: s.upsertBranchProductAsync,
      toggleAvailabilityAsync: s.toggleAvailabilityAsync,
      linkAllergenToProductAsync: s.linkAllergenToProductAsync,
      unlinkAllergenFromProductAsync: s.unlinkAllergenFromProductAsync,
    })),
  )
