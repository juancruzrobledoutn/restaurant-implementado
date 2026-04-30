/**
 * CartSharedItem — read-only cart item from another diner.
 * Shows DinerAvatar + name, quantity, and subtotal.
 */
import { useTranslation } from 'react-i18next'
import { DinerAvatar } from './DinerAvatar'
import { formatCartItemSubtotal } from '../../utils/price'
import type { CartItem } from '../../types/cart'

interface CartSharedItemProps {
  item: CartItem
  locale?: string
}

export function CartSharedItem({ item, locale = 'es-AR' }: CartSharedItemProps) {
  const { t } = useTranslation()
  const subtotal = formatCartItemSubtotal(item.priceCentsSnapshot, item.quantity, locale)

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-100">
      <DinerAvatar dinerId={item.dinerId} dinerName={item.dinerName} size="sm" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{item.productName}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {t('cart.sharedBy', { name: item.dinerName })}
        </p>
        {item.notes && (
          <p className="text-xs text-gray-400 truncate mt-0.5 italic">{item.notes}</p>
        )}
      </div>

      <div className="text-right flex-shrink-0">
        <p className="text-xs text-gray-500">×{item.quantity}</p>
        <p className="text-sm font-semibold text-gray-700">{subtotal}</p>
      </div>
    </div>
  )
}
