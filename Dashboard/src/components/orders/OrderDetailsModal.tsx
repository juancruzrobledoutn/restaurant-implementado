/**
 * OrderDetailsModal — round detail modal with timeline and items (C-25).
 *
 * Shows: timestamps timeline, items list (with voided marker),
 * metadata (mesa, sector, comensal, role), and "Cancelar ronda" button
 * conditioned on role + cancelable status.
 *
 * Skill: dashboard-crud-page, interface-design
 */

import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatPrice } from '@/utils/formatters'
import type { BadgeVariant } from '@/components/ui/Badge'
import type { Round, RoundStatus } from '@/types/operations'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANCELABLE_STATUSES: Set<RoundStatus> = new Set([
  'PENDING', 'CONFIRMED', 'SUBMITTED', 'IN_KITCHEN', 'READY',
])

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

function formatTS(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OrderDetailsModalProps {
  round: Round | null
  isOpen: boolean
  onClose: () => void
  canCancel: boolean
  onCancel: (roundId: string) => void
}

export function OrderDetailsModal({
  round,
  isOpen,
  onClose,
  canCancel,
  onCancel,
}: OrderDetailsModalProps) {
  if (!round) return null

  const isCancelable = CANCELABLE_STATUSES.has(round.status)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Ronda #${round.round_number} — Mesa ${round.table_code}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          {canCancel && isCancelable ? (
            <Button
              variant="danger"
              onClick={() => onCancel(round.id)}
            >
              Cancelar ronda
            </Button>
          ) : <span />}
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Metadata */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-400">Mesa</span>
            <p className="text-white font-medium">{round.table_code} (#{round.table_number})</p>
          </div>
          {round.sector_name && (
            <div>
              <span className="text-gray-400">Sector</span>
              <p className="text-white">{round.sector_name}</p>
            </div>
          )}
          {round.diner_name && (
            <div>
              <span className="text-gray-400">Comensal</span>
              <p className="text-white">{round.diner_name}</p>
            </div>
          )}
          <div>
            <span className="text-gray-400">Creada por</span>
            <p className="text-white">{round.created_by_role}</p>
          </div>
          <div>
            <span className="text-gray-400">Estado</span>
            <div className="mt-0.5">
              <Badge variant={statusVariant(round.status)}>
                {statusLabel(round.status)}
              </Badge>
            </div>
          </div>
          {round.cancel_reason && (
            <div className="col-span-2">
              <span className="text-gray-400">Razon de cancelacion</span>
              <p className="text-red-300 text-sm mt-0.5">{round.cancel_reason}</p>
            </div>
          )}
        </div>

        {/* Timestamps timeline */}
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Historial de estados</h3>
          <div className="space-y-1.5 text-xs">
            {round.pending_at    && <TimestampRow label="Pendiente"    ts={round.pending_at} />}
            {round.confirmed_at  && <TimestampRow label="Confirmada"   ts={round.confirmed_at} />}
            {round.submitted_at  && <TimestampRow label="Enviada"      ts={round.submitted_at} />}
            {round.in_kitchen_at && <TimestampRow label="En cocina"    ts={round.in_kitchen_at} />}
            {round.ready_at      && <TimestampRow label="Lista"        ts={round.ready_at} />}
            {round.served_at     && <TimestampRow label="Servida"      ts={round.served_at} />}
            {round.canceled_at   && <TimestampRow label="Cancelada"    ts={round.canceled_at} />}
          </div>
        </div>

        {/* Items */}
        {round.items && round.items.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2">
              Items ({round.items.filter((i) => !i.is_voided).length} activos
              {round.items.some((i) => i.is_voided) ? `, ${round.items.filter((i) => i.is_voided).length} anulados` : ''})
            </h3>
            <div className="space-y-1.5">
              {round.items.map((item) => (
                <div
                  key={item.id}
                  className={[
                    'flex items-center justify-between rounded-md px-3 py-2 text-sm',
                    item.is_voided
                      ? 'bg-red-900/20 text-red-400 line-through'
                      : 'bg-gray-800 text-white',
                  ].join(' ')}
                >
                  <div>
                    <span>Producto #{item.product_id}</span>
                    {item.notes && (
                      <span className="text-gray-400 ml-2 text-xs">({item.notes})</span>
                    )}
                    {item.is_voided && item.void_reason && (
                      <span className="ml-2 text-xs text-red-400 no-underline">
                        — {item.void_reason}
                      </span>
                    )}
                  </div>
                  <div className="text-right text-xs">
                    <span>x{item.quantity}</span>
                    <span className="ml-2">{formatPrice(item.price_cents_snapshot * item.quantity)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="flex justify-end mt-3 text-sm font-semibold text-white border-t border-gray-700 pt-2">
              Total: {formatPrice(round.total_cents)}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function TimestampRow({ label, ts }: { label: string; ts: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-gray-400 w-24">{label}</span>
      <span className="text-gray-200">{formatTS(ts)}</span>
    </div>
  )
}
