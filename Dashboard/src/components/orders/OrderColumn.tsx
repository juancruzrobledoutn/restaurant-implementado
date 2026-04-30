/**
 * OrderColumn — a single kanban column with a list of OrderCards (C-25).
 *
 * Shows up to MAX_CARDS rounds (ordered by pending_at DESC as received from store).
 * Shows "Sin rondas" when empty.
 * Renders an overflow notice when total rounds exceed MAX_CARDS.
 *
 * Skill: vercel-react-best-practices (memo + useMemo)
 */

import { memo, useMemo } from 'react'
import { OrderCard } from './OrderCard'
import type { Round, RoundStatus } from '@/types/operations'

const MAX_CARDS = 50

interface OrderColumnProps {
  status: RoundStatus
  rounds: Round[]
  onOpenDetail: (id: string) => void
}

const COLUMN_LABELS: Record<RoundStatus, string> = {
  PENDING:    'Pendiente',
  CONFIRMED:  'Confirmada',
  SUBMITTED:  'Enviada',
  IN_KITCHEN: 'En cocina',
  READY:      'Lista',
  SERVED:     'Servida',
  CANCELED:   'Cancelada',
}

export const OrderColumn = memo(function OrderColumn({
  status,
  rounds,
  onOpenDetail,
}: OrderColumnProps) {
  const visible = useMemo(
    () => rounds.slice(0, MAX_CARDS),
    [rounds],
  )
  const overflow = rounds.length - visible.length

  return (
    <div className="flex flex-col min-w-0 flex-1">
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-900 sticky top-0 z-10">
        <span className="text-sm font-semibold text-gray-200">{COLUMN_LABELS[status]}</span>
        <span className="ml-2 rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
          {rounds.length}
        </span>
      </div>

      {/* Cards list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {visible.length === 0 ? (
          <p className="text-center text-xs text-gray-500 py-6">Sin rondas</p>
        ) : (
          visible.map((round) => (
            <OrderCard key={round.id} round={round} onOpenDetail={onOpenDetail} />
          ))
        )}

        {overflow > 0 && (
          <p className="text-center text-xs text-gray-500 py-2">
            Mostrando {MAX_CARDS} de {rounds.length} — usá la vista Lista para ver el resto
          </p>
        )}
      </div>
    </div>
  )
})
