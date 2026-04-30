/**
 * CartItem — editable cart item for the current diner.
 * Shows spinner + reduced opacity while pending (optimistic).
 */
import { useTranslation } from 'react-i18next'
import { formatCartItemSubtotal } from '../../utils/price'
import type { CartItem as CartItemType } from '../../types/cart'

interface CartItemProps {
  item: CartItemType
  onIncrement: (id: string) => void
  onDecrement: (id: string) => void
  onRemove: (id: string) => void
  disabled?: boolean
  locale?: string
}

export function CartItem({
  item,
  onIncrement,
  onDecrement,
  onRemove,
  disabled = false,
  locale = 'es-AR',
}: CartItemProps) {
  const { t } = useTranslation()
  const subtotal = formatCartItemSubtotal(item.priceCentsSnapshot, item.quantity, locale)
  const isPending = item.pending
  const isDisabled = disabled || isPending

  return (
    <div
      className={`flex items-center gap-3 py-3 border-b border-gray-100 transition-opacity ${
        isPending ? 'opacity-60' : 'opacity-100'
      }`}
    >
      {/* Pending spinner */}
      {isPending && (
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{item.productName}</p>
        {item.notes && (
          <p className="text-xs text-gray-500 truncate mt-0.5">{item.notes}</p>
        )}
        <p className="text-sm font-semibold text-primary mt-1">{subtotal}</p>
      </div>

      {/* Quantity controls */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          data-testid="cart-item-minus"
          onClick={() => {
            if (item.quantity <= 1) {
              onRemove(item.id)
            } else {
              onDecrement(item.id)
            }
          }}
          disabled={isDisabled}
          className="min-w-[44px] min-h-[44px] rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label={t('cart.decrement')}
        >
          −
        </button>

        <span className="text-sm font-medium text-gray-800 w-4 text-center">
          {item.quantity}
        </span>

        <button
          data-testid="cart-item-plus"
          onClick={() => onIncrement(item.id)}
          disabled={isDisabled}
          className="min-w-[44px] min-h-[44px] rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label={t('cart.increment')}
        >
          +
        </button>

        <button
          data-testid="cart-item-remove"
          onClick={() => onRemove(item.id)}
          disabled={isDisabled}
          className="ml-1 min-w-[44px] min-h-[44px] text-red-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          aria-label={t('cart.remove')}
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
