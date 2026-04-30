/**
 * CheckSummary — Grid of charges with total and remaining balance (C-19 / Task 9.1).
 *
 * Reads from billingStore.
 * All money formatted via formatPrice.
 */
import { useTranslation } from 'react-i18next'
import { useBillingStore, selectCharges, selectTotalCents, selectRemainingCents, selectBillingStatus } from '../../stores/billingStore'
import { useShallow } from 'zustand/react/shallow'
import { ChargeRow } from './ChargeRow'
import { formatPrice } from '../../utils/price'

export function CheckSummary() {
  const { t } = useTranslation()

  const charges = useBillingStore(useShallow(selectCharges))
  const totalCents = useBillingStore(selectTotalCents)
  const remainingCents = useBillingStore(selectRemainingCents)
  const status = useBillingStore(selectBillingStatus)

  return (
    <div className="flex flex-col gap-4 overflow-x-hidden w-full max-w-full">
      {/* Status badge */}
      {status && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-500 uppercase tracking-wide">
            {t(`check.status.${status.toLowerCase()}`)}
          </span>
        </div>
      )}

      {/* Charges list */}
      <section aria-labelledby="charges-heading">
        <h3 id="charges-heading" className="text-base font-semibold text-gray-800 mb-2">
          {t('check.charges.title')}
        </h3>
        {charges.length === 0 ? (
          <p className="text-sm text-gray-500">{t('check.charges.empty')}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {charges.map((charge) => (
              <li key={charge.id}>
                <ChargeRow charge={charge} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Totals */}
      <div className="border-t border-gray-200 pt-4 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">{t('check.total')}</span>
          <span className="text-base font-semibold text-gray-800">
            {formatPrice(totalCents)}
          </span>
        </div>
        {remainingCents > 0 && remainingCents < totalCents && (
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">{t('check.remaining')}</span>
            <span className="text-base font-semibold text-orange-600">
              {formatPrice(remainingCents)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
