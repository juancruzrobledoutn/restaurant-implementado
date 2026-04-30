/**
 * cascadeService — client-side cascade delete preview and wrapper functions.
 *
 * Preview is computed from already-hydrated Zustand stores (no extra backend request).
 * The actual cascade execution is performed server-side.
 * The WS CASCADE_DELETE event reconciles stores after the fact.
 *
 * Decision D8 (design.md): preview is UX, not a contract — if stores are
 * slightly stale, the backend executes the real cascade regardless.
 *
 * Skill: dashboard-crud-page
 */

import type { CascadePreview } from '@/types/menu'

// Store imports — lazy to avoid circular deps at module parse time
// Each getter is a function that reads the store state directly
function getCategoryStore() {
  return import('@/stores/categoryStore').then((m) => m.useCategoryStore.getState())
}

function getSubcategoryStore() {
  return import('@/stores/subcategoryStore').then((m) => m.useSubcategoryStore.getState())
}

function getProductStore() {
  return import('@/stores/productStore').then((m) => m.useProductStore.getState())
}

function getIngredientStore() {
  return import('@/stores/ingredientStore').then((m) => m.useIngredientStore.getState())
}

function getAllergenStore() {
  return import('@/stores/allergenStore').then((m) => m.useAllergenStore.getState())
}

// ---------------------------------------------------------------------------
// Preview functions — return CascadePreview | null
// ---------------------------------------------------------------------------

/**
 * Computes the cascade preview for deleting a category.
 * Affected: subcategories + products under those subcategories.
 */
export async function getCategoryPreview(categoryId: string): Promise<CascadePreview | null> {
  const [subStore, productStore] = await Promise.all([
    getSubcategoryStore(),
    getProductStore(),
  ])

  const affectedSubs = subStore.items.filter((s) => s.category_id === categoryId)
  const affectedSubIds = new Set(affectedSubs.map((s) => s.id))
  const affectedProducts = productStore.items.filter((p) => affectedSubIds.has(p.subcategory_id))

  const total = affectedSubs.length + affectedProducts.length
  if (total === 0) return null

  const items = []
  if (affectedSubs.length > 0) {
    items.push({ label: 'Subcategorías', count: affectedSubs.length })
  }
  if (affectedProducts.length > 0) {
    items.push({ label: 'Productos', count: affectedProducts.length })
  }

  return { totalItems: total, items }
}

/**
 * Computes the cascade preview for deleting a subcategory.
 * Affected: products under this subcategory.
 */
export async function getSubcategoryPreview(subcategoryId: string): Promise<CascadePreview | null> {
  const productStore = await getProductStore()

  const affectedProducts = productStore.items.filter((p) => p.subcategory_id === subcategoryId)
  if (affectedProducts.length === 0) return null

  return {
    totalItems: affectedProducts.length,
    items: [{ label: 'Productos', count: affectedProducts.length }],
  }
}

/**
 * Computes the cascade preview for deleting an ingredient group.
 * Affected: ingredients + sub-ingredients.
 */
export async function getIngredientGroupPreview(groupId: string): Promise<CascadePreview | null> {
  const store = await getIngredientStore()

  const affectedIngredients = store.ingredients.filter((i) => i.group_id === groupId)
  const affectedIngredientIds = new Set(affectedIngredients.map((i) => i.id))
  const affectedSubs = store.subIngredients.filter((s) =>
    affectedIngredientIds.has(s.ingredient_id),
  )

  const total = affectedIngredients.length + affectedSubs.length
  if (total === 0) return null

  const items = []
  if (affectedIngredients.length > 0) {
    items.push({ label: 'Ingredientes', count: affectedIngredients.length })
  }
  if (affectedSubs.length > 0) {
    items.push({ label: 'Sub-ingredientes', count: affectedSubs.length })
  }

  return { totalItems: total, items }
}

/**
 * Computes the cascade preview for deleting an allergen.
 * Affected: product-allergen links (cross-reactions removed server-side).
 */
export async function getAllergenPreview(allergenId: string): Promise<CascadePreview | null> {
  const store = await getAllergenStore()

  const linkedProducts = store.productAllergens.filter((pa) => pa.allergen_id === allergenId)
  if (linkedProducts.length === 0) return null

  return {
    totalItems: linkedProducts.length,
    items: [{ label: 'Productos vinculados', count: linkedProducts.length }],
  }
}

// ---------------------------------------------------------------------------
// Delete wrapper functions — call store.deleteAsync and rely on server cascade
// ---------------------------------------------------------------------------

export async function deleteCategoryWithCascade(id: string): Promise<void> {
  const store = await getCategoryStore()
  await store.deleteAsync(id)
}

export async function deleteSubcategoryWithCascade(id: string): Promise<void> {
  const store = await getSubcategoryStore()
  await store.deleteAsync(id)
}

export async function deleteIngredientGroupWithCascade(id: string): Promise<void> {
  const store = await getIngredientStore()
  await store.deleteGroupAsync(id)
}

export async function deleteAllergenWithCascade(id: string): Promise<void> {
  const store = await getAllergenStore()
  await store.deleteAsync(id)
}

// ---------------------------------------------------------------------------
// Sector cascade — C-16
// ---------------------------------------------------------------------------

function getSectorStore() {
  return import('@/stores/sectorStore').then((m) => m.useSectorStore.getState())
}

function getTableStore() {
  return import('@/stores/tableStore').then((m) => m.useTableStore.getState())
}

/**
 * Computes the cascade preview for deleting a sector.
 * Affected: tables that belong to this sector.
 *
 * The backend (C-07) soft-deletes all tables in the sector on sector delete.
 * This preview is computed from the already-hydrated tableStore.
 */
export async function getSectorPreview(sectorId: string): Promise<CascadePreview | null> {
  const tableStore = await getTableStore()

  const affectedTables = tableStore.items.filter((t) => t.sector_id === sectorId && t.is_active)
  if (affectedTables.length === 0) return null

  return {
    totalItems: affectedTables.length,
    items: [{ label: 'Mesas', count: affectedTables.length }],
  }
}

/**
 * Deletes a sector — server-side cascade removes all its tables.
 */
export async function deleteSectorWithCascade(id: string): Promise<void> {
  const store = await getSectorStore()
  await store.deleteSectorAsync(id)
}

// ---------------------------------------------------------------------------
// Promotion cascade — C-27
// ---------------------------------------------------------------------------

function getPromotionStore() {
  return import('@/stores/promotionStore').then((m) => m.usePromotionStore.getState())
}

/**
 * Computes the cascade preview for deleting a promotion.
 * Shows count of linked branches and items.
 *
 * Returns null if the promotion is not found in the store (edge case: not hydrated yet).
 * The backend executes the real cascade regardless — preview is UX only.
 */
export async function getPromotionPreview(promotionId: string): Promise<CascadePreview | null> {
  const store = await getPromotionStore()
  const promotion = store.items.find((p) => p.id === promotionId)
  if (!promotion) return null

  const previewItems = [
    { label: 'promotions.cascade.branches', count: promotion.branches.length },
    { label: 'promotions.cascade.items', count: promotion.items.length },
  ].filter((i) => i.count > 0)

  const total = previewItems.reduce((sum, i) => sum + i.count, 0)

  return { totalItems: total, items: previewItems }
}

/**
 * Deletes a promotion — delegates to promotionStore.deleteAsync.
 * Server-side cascade removes all PromotionBranch and PromotionItem links.
 */
export async function deletePromotionWithCascade(promotionId: string): Promise<void> {
  const store = await getPromotionStore()
  return store.deleteAsync(promotionId)
}
