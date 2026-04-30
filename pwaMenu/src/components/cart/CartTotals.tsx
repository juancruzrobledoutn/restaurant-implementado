/**
 * CartTotals — displays item count, subtotals, and total.
 */
import { useTranslation } from 'react-i18next'
import { formatPrice } from '../../utils/price'

interface CartTotalsProps {
  itemCount: number
  totalCents: number
  confirmedTotalCents: number
  hasPendingItems: boolean
  locale?: string
}

export function CartTotals({
  itemCount,
  totalCents,
  confirmedTotalCents,
  hasPendingItems,
  locale = 'es-AR',
}: CartTotalsProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{t('cart.itemCount', { count: itemCount })}</span>
        {hasPendingItems && (
          <span className="text-xs text-amber-600 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
            {t('cart.pending')}
          </span>
        )}
      </div>

      {hasPendingItems && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>{t('cart.confirmedSubtotal')}</span>
          <span>{formatPrice(confirmedTotalCents, locale)}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-base font-bold text-gray-900 pt-1 border-t border-gray-200">
        <span>{t('cart.total')}</span>
        <span className="text-primary">{formatPrice(totalCents, locale)}</span>
      </div>
    </div>
  )
}
