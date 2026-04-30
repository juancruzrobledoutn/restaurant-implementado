/**
 * RoundCard — displays a single round with its items and status.
 * If status is PENDING, shows a "Confirmar" button.
 */
import { useCompactMenuStore, selectProductById } from '@/stores/compactMenuStore'
import type { Round } from '@/stores/roundsStore'

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente de confirmación',
  CONFIRMED: 'Confirmado',
  SUBMITTED: 'Enviado a cocina',
  IN_KITCHEN: 'En preparación',
  READY: 'Listo para servir',
  SERVED: 'Servido',
  CANCELED: 'Cancelado',
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'border-yellow-400 bg-yellow-50',
  CONFIRMED: 'border-blue-300 bg-blue-50',
  SUBMITTED: 'border-blue-400 bg-blue-100',
  IN_KITCHEN: 'border-orange-400 bg-orange-50',
  READY: 'border-orange-500 bg-orange-100',
  SERVED: 'border-green-400 bg-green-50',
  CANCELED: 'border-gray-300 bg-gray-50',
}

interface RoundItemRow {
  id: string
  productId: string
  quantity: number
  notes?: string | null
}

/**
 * RoundCardItem — resolves product name from compactMenuStore.
 * Keeps the lookup in a child component so the hook is called once per item.
 */
function RoundCardItem({ item }: { item: RoundItemRow }) {
  const product = useCompactMenuStore(selectProductById(item.productId))
  const label = product?.name ?? `Producto #${item.productId}`
  return (
    <li className="flex justify-between text-sm">
      <span className="text-gray-800">
        {item.quantity}× {label}
      </span>
      {item.notes && (
        <span className="ml-2 text-xs italic text-gray-500">{item.notes}</span>
      )}
    </li>
  )
}

interface Props {
  round: Round
  onConfirm?: (roundId: string) => void
  isPending?: boolean
}

export function RoundCard({ round, onConfirm, isPending = false }: Props) {
  const statusLabel = STATUS_LABELS[round.status] ?? round.status
  const colorClass = STATUS_COLORS[round.status] ?? STATUS_COLORS['CONFIRMED']!

  return (
    <div className={`rounded-lg border-2 p-3 ${colorClass}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          {statusLabel}
        </span>
        <span className="text-xs text-gray-500">
          #{round.id.slice(-6)}
        </span>
      </div>

      <ul className="mb-3 space-y-1">
        {round.items.map((item) => (
          <RoundCardItem key={item.id} item={item} />
        ))}
      </ul>

      {round.status === 'PENDING' && onConfirm && (
        <button
          type="button"
          onClick={() => onConfirm(round.id)}
          disabled={isPending}
          className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        >
          {isPending ? 'Confirmando…' : 'Confirmar pedido'}
        </button>
      )}
    </div>
  )
}
