/**
 * KitchenTicketColumn — displays a vertical column of KitchenTicketCard items
 * for a specific round status (SUBMITTED, IN_KITCHEN, or READY).
 *
 * Props:
 *   title          — column header text (e.g. "Enviados")
 *   status         — the KitchenRoundStatus this column represents
 *   rounds         — the rounds to display (pre-filtered by caller)
 *   now            — current Date (from useNowTicker)
 *   onStatusChange — forwarded to each KitchenTicketCard
 */

import { KitchenTicketCard } from '@/components/kitchen/KitchenTicketCard'
import type { KitchenRound, KitchenRoundStatus } from '@/types/operations'

interface KitchenTicketColumnProps {
  title: string
  status: KitchenRoundStatus
  rounds: KitchenRound[]
  now: Date
  onStatusChange: (roundId: string, newStatus: KitchenRoundStatus) => void
}

const STATUS_HEADER_COLOR: Record<KitchenRoundStatus, string> = {
  SUBMITTED: 'border-yellow-500',
  IN_KITCHEN: 'border-orange-500',
  READY: 'border-green-500',
}

export function KitchenTicketColumn({
  title,
  status,
  rounds,
  now,
  onStatusChange,
}: KitchenTicketColumnProps) {
  const borderColor = STATUS_HEADER_COLOR[status]

  return (
    <section
      className="flex min-w-0 flex-1 flex-col gap-3"
      aria-label={`Columna: ${title}`}
    >
      {/* Column header */}
      <div className={`border-b-2 pb-2 ${borderColor}`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">
          {title}
          <span className="ml-2 rounded-full bg-gray-800 px-2 py-0.5 text-xs font-normal text-gray-400">
            {rounds.length}
          </span>
        </h2>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-3 overflow-y-auto">
        {rounds.length === 0 && (
          <p className="py-8 text-center text-xs text-gray-600 italic">
            Sin pedidos
          </p>
        )}
        {rounds.map((round) => (
          <KitchenTicketCard
            key={round.id}
            round={round}
            now={now}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>
    </section>
  )
}
