/**
 * KitchenTicketCard — displays a single kitchen round card with header,
 * item list, urgency badge, and a status-action button.
 *
 * Props:
 *   round          — the KitchenRound to display
 *   now            — current Date (from useNowTicker) for urgency calc
 *   onStatusChange — called with the next status when the action button is pressed
 *
 * Status transitions:
 *   SUBMITTED  → action: "Tomar pedido"   → IN_KITCHEN
 *   IN_KITCHEN → action: "Marcar listo"   → READY
 *   READY      → no action button (terminal state shown here)
 */

import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { UrgencyBadge } from '@/components/kitchen/UrgencyBadge'
import type { KitchenRound, KitchenRoundStatus } from '@/types/operations'

interface KitchenTicketCardProps {
  round: KitchenRound
  now: Date
  onStatusChange: (roundId: string, newStatus: KitchenRoundStatus) => void
}

const STATUS_ACTION: Partial<Record<KitchenRoundStatus, { label: string; next: KitchenRoundStatus }>> = {
  SUBMITTED: { label: 'Tomar pedido', next: 'IN_KITCHEN' },
  IN_KITCHEN: { label: 'Marcar listo', next: 'READY' },
}

function getElapsedMinutes(submittedAt: string, now: Date): number {
  const submitted = new Date(submittedAt)
  return (now.getTime() - submitted.getTime()) / 60_000
}

export function KitchenTicketCard({ round, now, onStatusChange }: KitchenTicketCardProps) {
  const elapsedMinutes = getElapsedMinutes(round.submitted_at, now)
  const action = STATUS_ACTION[round.status]

  const activeItems = round.items.filter((item) => !item.is_voided)

  return (
    <Card padding="sm" className="flex flex-col gap-3" data-testid="kitchen-ticket">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">
            Mesa {round.table_number}
            {round.sector_name && (
              <span className="ml-1 text-xs font-normal text-gray-400">
                — {round.sector_name}
              </span>
            )}
          </p>
          <p className="text-xs text-gray-500">
            {round.diner_count} {round.diner_count === 1 ? 'comensal' : 'comensales'}
          </p>
        </div>
        <UrgencyBadge elapsedMinutes={elapsedMinutes} />
      </div>

      {/* Item list */}
      <ul className="divide-y divide-gray-800" aria-label="Items del pedido">
        {activeItems.map((item, idx) => (
          <li
            key={idx}
            className="flex items-start justify-between gap-2 py-1.5 text-sm"
          >
            <span className="flex-1 text-gray-200">
              <span className="mr-2 font-semibold text-white">{item.quantity}×</span>
              {item.product_name}
              {item.notes && (
                <span className="ml-1 block text-xs text-gray-400 italic">
                  {item.notes}
                </span>
              )}
            </span>
          </li>
        ))}
        {activeItems.length === 0 && (
          <li className="py-2 text-xs text-gray-500 italic">Sin items activos</li>
        )}
      </ul>

      {/* Action button */}
      {action && (
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          onClick={() => onStatusChange(round.id, action.next)}
        >
          {action.label}
        </Button>
      )}
    </Card>
  )
}
