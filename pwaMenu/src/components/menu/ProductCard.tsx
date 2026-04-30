/**
 * ProductCard — renders a single product.
 * - Image fallback to /fallback-product.svg on error
 * - Price formatted via formatPrice
 * - Allergen chips
 * - "Agregar" button dispatches cartStore.addItem with optimistic UI
 * - Badge with current quantity in cart
 * - Disabled when tableStatus === 'PAYING'
 */
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { formatPrice } from '../../utils/price'
import { useCartStore } from '../../stores/cartStore'
import { useSessionStore, selectIsPaying, selectDinerId } from '../../stores/sessionStore'
import { useOptimisticCart } from '../../hooks/useOptimisticCart'
import type { Product } from '../../types/menu'

interface ProductCardProps {
  product: Product
}

export function ProductCard({ product }: ProductCardProps) {
  const { t } = useTranslation()
  const [imgSrc, setImgSrc] = useState(product.imageUrl ?? '/fallback-product.svg')
  const [isAdding, setIsAdding] = useState(false)

  const isPaying = useSessionStore(selectIsPaying)
  const dinerId = useSessionStore(selectDinerId) ?? ''

  // Count how many of this product the current diner has in cart
  const cartItemCount = useCartStore(
    useShallow((s) => {
      let count = 0
      for (const item of Object.values(s.items)) {
        if (item.productId === product.id && item.dinerId === dinerId) {
          count += item.quantity
        }
      }
      return count
    }),
  )

  const { addItem } = useOptimisticCart()

  const handleAdd = useCallback(() => {
    if (isPaying || isAdding) return
    setIsAdding(true)
    addItem({ id: product.id, name: product.name, priceCents: product.priceCents }, 1)
    // Brief visual feedback
    setTimeout(() => setIsAdding(false), 600)
  }, [isPaying, isAdding, addItem, product])

  if (!product.isAvailable) return null

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex gap-3 p-3">
      <div className="relative flex-shrink-0">
        <img
          src={imgSrc}
          alt={t('product.imageAlt', { name: product.name })}
          onError={() => setImgSrc('/fallback-product.svg')}
          className="w-20 h-20 object-cover rounded-lg bg-gray-100"
          loading="lazy"
          decoding="async"
        />
        {cartItemCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-white text-xs font-bold rounded-full flex items-center justify-center">
            {cartItemCount}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
          {product.name}
        </h3>
        {product.description && (
          <p className="text-gray-500 text-xs mt-1 line-clamp-2">{product.description}</p>
        )}
        <p className="text-primary font-bold text-sm mt-2">{formatPrice(product.priceCents)}</p>
        {product.allergens.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {product.allergens.map((a) => (
              <span
                key={a.id}
                className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded"
              >
                {t(`allergen.${a.code}`, { defaultValue: a.code })}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Add button */}
      <div className="flex flex-col justify-center flex-shrink-0">
        <button
          onClick={handleAdd}
          disabled={isPaying || isAdding || !product.isAvailable}
          title={isPaying ? t('cart.blocked.paying.tooltip') : undefined}
          aria-label={t('cart.add')}
          className="w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center font-bold text-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-95"
        >
          {isAdding ? (
            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            '+'
          )}
        </button>
      </div>
    </div>
  )
}
