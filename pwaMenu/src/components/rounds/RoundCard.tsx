/**
 * RoundCard — full card for a round showing status, items, timestamps, and total.
 */
import { useTranslation } from 'react-i18next'
import { RoundStatusBadge } from './RoundStatusBadge'
import { RoundItemList } from './RoundItemList'
import { formatPrice } from '../../utils/price'
import type { Round } from '../../types/round'

interface RoundCardProps {
  round: Round
  locale?: string
}

function formatTime(isoString: string | null): string {
  if (!isoString) return ''
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function RoundCard({ round, locale = 'es-AR' }: RoundCardProps) {
  const { t } = useTranslation()

  const totalCents = round.items.reduce(
    (acc, item) => acc + item.priceCentsSnapshot * item.quantity,
    0,
  )

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {t('rounds.roundNumber', { number: round.roundNumber })}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {t('rounds.submittedAt', { time: formatTime(round.submittedAt) })}
          </p>
        </div>
        <RoundStatusBadge status={round.status} />
      </div>

      {/* Items */}
      <div className="px-4 py-3">
        <RoundItemList items={round.items} locale={locale} />
      </div>

      {/* Footer: timestamps + total */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100">
        <div className="text-xs text-gray-400 space-y-0.5">
          {round.readyAt && (
            <p>
              {t('rounds.readyAt', { time: formatTime(round.readyAt) })}
            </p>
          )}
          {round.servedAt && (
            <p>
              {t('rounds.servedAt', { time: formatTime(round.servedAt) })}
            </p>
          )}
        </div>
        <p className="text-sm font-bold text-primary">
          {formatPrice(totalCents, locale)}
        </p>
      </div>
    </div>
  )
}
