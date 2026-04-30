/**
 * OrderCard — compact card for a round in the kanban column view (C-25).
 *
 * Shows: table_code, sector_name, items_count, time in current state,
 *        status Badge, diner_name if present.
 *
 * Skill: dashboard-crud-page, interface-design
 */

import { memo } from 'react'
import { Badge } from '@/components/ui/Badge'
import { formatPrice } from '@/utils/formatters'
import type { BadgeVariant } from '@/components/ui/Badge'
import type { Round, RoundStatus } from '@/types/operations'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusVariant(status: RoundStatus): BadgeVariant {
  switch (status) {
    case 'PENDING':    return 'warning'
    case 'CONFIRMED':  return 'info'
    case 'SUBMITTED':  return 'info'
    case 'IN_KITCHEN': return 'warning'
    case 'READY':      return 'success'
    case 'SERVED':     return 'neutral'
    case 'CANCELED':   return 'danger'
    default:           return 'neutral'
  }
}

function statusLabel(status: RoundStatus): string {
  switch (status) {
    case 'PENDING':    return 'Pendiente'
    case 'CONFIRMED':  return 'Confirmada'
    case 'SUBMITTED':  return 'Enviada'
    case 'IN_KITCHEN': return 'En cocina'
    case 'READY':      return 'Lista'
    case 'SERVED':     return 'Servida'
    case 'CANCELED':   return 'Cancelada'
    default:           return status
  }
}

/** Returns the latest relevant timestamp for the given status. */
function getStatusTimestamp(round: Round): string | null {
  switch (round.status) {
    case 'PENDING':    return round.pending_at
    case 'CONFIRMED':  return round.confirmed_at
    case 'SUBMITTED':  return round.submitted_at
    case 'IN_KITCHEN': return round.in_kitchen_at
    case 'READY':      return round.ready_at
    case 'SERVED':     return round.served_at
    case 'CANCELED':   return round.canceled_at
    default:           return null
  }
}

/** Format elapsed time since a timestamp as "Xm" or "Xh Ym". */
function timeElapsed(isoTimestamp: string | null): string {
  if (!isoTimestamp) return ''
  const diffMs = Date.now() - new Date(isoTimestamp).getTime()
  if (diffMs < 0) return ''
  const totalMin = Math.floor(diffMs / 60_000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OrderCardProps {
  round: Round
  onOpenDetail: (id: string) => void
}

export const OrderCard = memo(function OrderCard({ round, onOpenDetail }: OrderCardProps) {
  const ts = getStatusTimestamp(round)
  const elapsed = timeElapsed(ts)

  return (
    <button
      type="button"
      className="w-full text-left rounded-md border border-gray-700 bg-gray-800 p-3 hover:bg-gray-700 hover:border-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => onOpenDetail(round.id)}
      aria-label={`Ronda #${round.round_number} mesa ${round.table_code}`}
    >
      {/* Header: table code + elapsed time */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold text-sm text-white">Mesa {round.table_code}</span>
        {elapsed && (
          <span className="text-xs text-gray-400" aria-label={`Tiempo en estado: ${elapsed}`}>
            {elapsed}
          </span>
        )}
      </div>

      {/* Sector name */}
      {round.sector_name && (
        <p className="text-xs text-gray-400 mb-1">{round.sector_name}</p>
      )}

      {/* Diner name (optional) */}
      {round.diner_name && (
        <p className="text-xs text-gray-400 mb-1">Comensal: {round.diner_name}</p>
      )}

      {/* Footer: items count + total + status badge */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-400">
          {round.items_count} {round.items_count === 1 ? 'item' : 'items'}
          {' · '}
          {formatPrice(round.total_cents)}
        </span>
        <Badge variant={statusVariant(round.status)}>
          {statusLabel(round.status)}
        </Badge>
      </div>
    </button>
  )
})
