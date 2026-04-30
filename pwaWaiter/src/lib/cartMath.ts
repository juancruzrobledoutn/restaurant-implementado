/**
 * cartMath.ts — pure functions for cart total computation.
 * No React, no Zustand imports.
 *
 * Prices in cents (int). NEVER float arithmetic for money.
 */

import type { CompactProduct } from '@/services/waiter'

export interface CartItem {
  productId: string
  quantity: number
  notes?: string
}

/**
 * Compute total cart value in cents.
 *
 * @param items   Cart items from waiterCartStore
 * @param products  Product list from compactMenuStore
 * @returns Total in cents (integer)
 */
export function computeCartTotalCents(
  items: CartItem[],
  products: CompactProduct[],
): number {
  const productMap = new Map(products.map((p) => [p.id, p]))
  return items.reduce((total, item) => {
    const product = productMap.get(item.productId)
    if (!product) return total
    return total + product.priceCents * item.quantity
  }, 0)
}

/**
 * Format cents to display string (e.g., 12550 → "$125.50").
 */
export function formatPriceCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
