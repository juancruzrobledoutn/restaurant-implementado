/**
 * ChargeRow — Single charge item in CheckSummary (C-19 / Task 9.2).
 *
 * Displays diner name, split method label, and amount.
 * Reuses the diner color utility for the avatar.
 */
import { useTranslation } from 'react-i18next'
import { getDinerColor } from '../../utils/dinerColor'
import { formatPrice } from '../../utils/price'
import type { Charge } from '../../types/billing'

interface ChargeRowProps {
  charge: Charge
}

export function ChargeRow({ charge }: ChargeRowProps) {
  const { t } = useTranslation()
  const color = getDinerColor(charge.dinerId)

  return (
    <div className="flex items-center gap-3 py-3 overflow-x-hidden w-full max-w-full">
      {/* Diner avatar */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        {charge.dinerName.charAt(0).toUpperCase()}
      </div>

      {/* Diner name + split method */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{charge.dinerName}</p>
        <p className="text-xs text-gray-500">
          {t(`check.split.${charge.splitMethod.replace('_split', '').replace('by_consumption', 'by_consumption').replace('equal', 'equal').replace('custom', 'custom')}`)}
        </p>
      </div>

      {/* Amount */}
      <span className="flex-shrink-0 text-sm font-semibold text-gray-800">
        {formatPrice(charge.amountCents)}
      </span>
    </div>
  )
}
