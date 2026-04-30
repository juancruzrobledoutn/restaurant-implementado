/**
 * RoundStatusBadge — displays a colored badge for a round's status.
 * READY status pulses orange. All text is translated via t().
 */
import { useTranslation } from 'react-i18next'
import type { RoundStatus } from '../../types/round'

interface RoundStatusBadgeProps {
  status: RoundStatus
}

const STATUS_CONFIG: Record<
  RoundStatus,
  { classes: string; animate?: boolean }
> = {
  PENDING: {
    classes: 'bg-gray-100 text-gray-600',
  },
  CONFIRMED: {
    classes: 'bg-orange-100 text-orange-700',
  },
  SUBMITTED: {
    classes: 'bg-blue-100 text-blue-700',
  },
  IN_KITCHEN: {
    classes: 'bg-yellow-100 text-yellow-800',
  },
  READY: {
    classes: 'bg-orange-100 text-orange-700',
    animate: true,
  },
  SERVED: {
    classes: 'bg-green-100 text-green-700',
  },
  CANCELED: {
    classes: 'bg-gray-100 text-gray-400',
  },
}

export function RoundStatusBadge({ status }: RoundStatusBadgeProps) {
  const { t } = useTranslation()
  const config = STATUS_CONFIG[status]

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.classes}`}
    >
      {config.animate && (
        <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse inline-block" />
      )}
      {t(`rounds.status.${status.toLowerCase()}`)}
    </span>
  )
}
