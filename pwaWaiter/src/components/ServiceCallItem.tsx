/**
 * ServiceCallItem — renders a single service call with ACK/Close buttons.
 */
import type { ServiceCallDTO } from '@/services/waiter'

interface Props {
  call: ServiceCallDTO
  onAck?: (id: string) => void
  onClose?: (id: string) => void
  isAcking?: boolean
  isClosing?: boolean
}

export function ServiceCallItem({ call, onAck, onClose, isAcking = false, isClosing = false }: Props) {
  const timeLabel = new Date(call.createdAt).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="truncate text-sm font-medium text-gray-900">
            Mesa {call.tableId}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
          <span>{timeLabel}</span>
          {call.status === 'ACKED' && (
            <span className="rounded-full bg-yellow-100 px-1.5 py-0.5 text-yellow-700">
              Visto
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        {call.status === 'OPEN' && onAck && (
          <button
            type="button"
            onClick={() => onAck(call.id)}
            disabled={isAcking}
            className="rounded-md bg-yellow-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-yellow-600 disabled:opacity-50"
          >
            {isAcking ? '…' : 'Acusar recibo'}
          </button>
        )}
        {onClose && call.status !== 'CLOSED' && (
          <button
            type="button"
            onClick={() => onClose(call.id)}
            disabled={isClosing}
            className="rounded-md bg-gray-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isClosing ? '…' : 'Cerrar'}
          </button>
        )}
      </div>
    </div>
  )
}
