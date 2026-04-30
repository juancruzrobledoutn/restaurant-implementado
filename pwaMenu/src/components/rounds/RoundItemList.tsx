/**
 * RoundItemList — displays the list of items in a round.
 * Shows product name, quantity, and subtotal per item.
 */
import { formatCartItemSubtotal } from '../../utils/price'
import { DinerAvatar } from '../cart/DinerAvatar'
import type { RoundItem } from '../../types/round'

interface RoundItemListProps {
  items: RoundItem[]
  locale?: string
}

export function RoundItemList({ items, locale = 'es-AR' }: RoundItemListProps) {
  if (items.length === 0) return null

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2 text-sm">
          <DinerAvatar dinerId={item.dinerId} dinerName={item.dinerName} size="sm" />
          <span className="flex-1 text-gray-700 truncate">{item.productName}</span>
          <span className="text-gray-500 text-xs flex-shrink-0">×{item.quantity}</span>
          <span className="font-medium text-gray-800 flex-shrink-0">
            {formatCartItemSubtotal(item.priceCentsSnapshot, item.quantity, locale)}
          </span>
        </li>
      ))}
    </ul>
  )
}
