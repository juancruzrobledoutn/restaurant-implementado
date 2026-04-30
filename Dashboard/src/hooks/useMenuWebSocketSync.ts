/**
 * useMenuWebSocketSync — connects to the Dashboard WebSocket and routes
 * ENTITY_CREATED / ENTITY_UPDATED / ENTITY_DELETED / CASCADE_DELETE events
 * to the appropriate Zustand store's applyWS* methods.
 *
 * Skill: ws-frontend-subscription, zustand-store-pattern
 *
 * Pattern: two-effect ref pattern to avoid listener accumulation.
 *   Effect 1 (no deps): syncs handlerRef.current on every render
 *   Effect 2 ([selectedBranchId]): subscribes once per branch change
 */

import { useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { dashboardWS } from '@/services/websocket'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { useCategoryStore } from '@/stores/categoryStore'
import { useSubcategoryStore } from '@/stores/subcategoryStore'
import { useProductStore } from '@/stores/productStore'
import { useAllergenStore } from '@/stores/allergenStore'
import { useIngredientStore } from '@/stores/ingredientStore'
import { useRecipeStore } from '@/stores/recipeStore'
import { usePromotionStore } from '@/stores/promotionStore'
import { toast } from '@/stores/toastStore'
import type { WSEvent, Promotion } from '@/types/menu'

export function useMenuWebSocketSync(): void {
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const { t } = useTranslation()

  // ------------------------------------------------------------------
  // Build the handler that routes WS events to store actions.
  // Reading stores via getState() avoids the need for selector deps.
  // ------------------------------------------------------------------
  const handleEvent = (event: WSEvent): void => {
    const { type, entity, id, data } = event

    if (type === 'CASCADE_DELETE') {
      _handleCascadeDelete(event, t)
      return
    }

    if (type === 'ENTITY_CREATED') {
      const payload = data ?? {}
      switch (entity) {
        case 'category':
          useCategoryStore.getState().applyWSCreated(payload)
          break
        case 'subcategory':
          useSubcategoryStore.getState().applyWSCreated(payload)
          break
        case 'product':
        case 'branch_product':
        case 'product_allergen':
          useProductStore.getState().applyWSCreated(entity, payload)
          break
        case 'allergen':
          useAllergenStore.getState().applyWSCreated(payload)
          break
        case 'ingredient_group':
        case 'ingredient':
        case 'sub_ingredient':
          useIngredientStore.getState().applyWSCreated(entity, payload)
          break
        case 'recipe':
          useRecipeStore.getState().applyWSCreated(payload)
          break
        case 'promotion':
          usePromotionStore.getState().applyWSCreated(payload as unknown as Promotion)
          break
      }
      return
    }

    if (type === 'ENTITY_UPDATED') {
      const payload = data ?? {}
      switch (entity) {
        case 'category':
          useCategoryStore.getState().applyWSUpdated(payload)
          break
        case 'subcategory':
          useSubcategoryStore.getState().applyWSUpdated(payload)
          break
        case 'product':
        case 'branch_product':
          useProductStore.getState().applyWSUpdated(entity, payload)
          break
        case 'allergen':
          useAllergenStore.getState().applyWSUpdated(payload)
          break
        case 'ingredient_group':
        case 'ingredient':
        case 'sub_ingredient':
          useIngredientStore.getState().applyWSUpdated(entity, payload)
          break
        case 'recipe':
          useRecipeStore.getState().applyWSUpdated(payload)
          break
        case 'promotion':
          usePromotionStore.getState().applyWSUpdated(payload as unknown as Promotion)
          break
      }
      return
    }

    if (type === 'ENTITY_DELETED') {
      if (!id) return
      switch (entity) {
        case 'category':
          useCategoryStore.getState().applyWSDeleted(id)
          break
        case 'subcategory':
          useSubcategoryStore.getState().applyWSDeleted(id)
          break
        case 'product':
        case 'branch_product':
        case 'product_allergen':
          useProductStore.getState().applyWSDeleted(entity, id)
          break
        case 'allergen':
          useAllergenStore.getState().applyWSDeleted(id)
          break
        case 'ingredient_group':
        case 'ingredient':
        case 'sub_ingredient':
          useIngredientStore.getState().applyWSDeleted(entity, id)
          break
        case 'recipe':
          useRecipeStore.getState().applyWSDeleted(id)
          break
        case 'promotion':
          usePromotionStore.getState().applyWSDeleted(id)
          break
      }
    }
  }

  // ------------------------------------------------------------------
  // Effect 1: sync ref on every render (no deps — intentional)
  // ------------------------------------------------------------------
  const handleEventRef = useRef(handleEvent)
  useEffect(() => {
    handleEventRef.current = handleEvent
  })

  // ------------------------------------------------------------------
  // Effect 2: subscribe once per branch change
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!selectedBranchId) return

    const unsubscribe = dashboardWS.onFiltered(
      selectedBranchId,
      '*',
      (e) => handleEventRef.current(e),
    )

    return unsubscribe
  }, [selectedBranchId])
}

// ---------------------------------------------------------------------------
// CASCADE_DELETE handler — server removes entities in bulk, we reconcile stores
// ---------------------------------------------------------------------------

function _handleCascadeDelete(event: WSEvent, t: (key: string, opts?: Record<string, unknown>) => string): void {
  const { entity, id, affected } = event
  if (!id) return

  switch (entity) {
    case 'category': {
      // Category cascade: remove category → all subcategories → all products for those subcategories
      useCategoryStore.getState().applyWSDeleted(id)
      const subcategories = useSubcategoryStore.getState().items.filter((sc) => sc.category_id === id)
      for (const sc of subcategories) {
        useSubcategoryStore.getState().applyWSDeleted(sc.id)
        useProductStore.getState().applyWSDeleted('product', sc.id)
      }
      break
    }
    case 'subcategory': {
      // Subcategory cascade: remove subcategory → all products
      useSubcategoryStore.getState().applyWSDeleted(id)
      const products = useProductStore.getState().items.filter((p) => p.subcategory_id === id)
      for (const p of products) {
        useProductStore.getState().applyWSDeleted('product', p.id)
      }
      break
    }
    case 'ingredient_group': {
      // IngredientGroup cascade: remove group → all ingredients → all subIngredients
      useIngredientStore.getState().applyWSDeleted('ingredient_group', id)
      const ingredients = useIngredientStore.getState().ingredients.filter((i) => i.group_id === id)
      for (const ing of ingredients) {
        useIngredientStore.getState().applyWSDeleted('ingredient', ing.id)
        // subIngredients will be cleaned up by deleteGroupAsync / WS reconciliation
      }
      break
    }
    case 'product': {
      useProductStore.getState().applyWSDeleted('product', id)
      break
    }
    case 'promotion': {
      // Promotion cascade: remove from store + show toast with affected count
      usePromotionStore.getState().applyWSDeleted(id)
      const totalAffected = affected ? Object.values(affected).reduce((sum, n) => sum + n, 0) : 0
      toast.info(t('promotions.cascadeNotified', { count: totalAffected }))
      break
    }
    default:
      // For all other entities, fall back to applyWSDeleted if available
      break
  }
}
