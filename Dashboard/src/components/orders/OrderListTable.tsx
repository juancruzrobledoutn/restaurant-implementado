/**
 * OrderListTable — table view for the admin orders page (C-25).
 *
 * Uses the existing Table component. Columns: #, mesa, sector, estado,
 * items, total, creada, acciones. Rows are clickable to open detail.
 *
 * Skill: dashboard-crud-page
 */

import { useMemo } from 'react'
import { Table } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatPrice } from '@/utils/formatters'
import type { TableColumn } from '@/components/ui/Table'
import type { BadgeVariant } from '@/components/ui/Badge'
import type { Round, RoundStatus } from '@/types/operations'
import { Eye } from 'lucide-react'

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

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OrderListTableProps {
  rounds: Round[]
  onOpenDetail: (id: string) => void
}

export function OrderListTable({ rounds, onOpenDetail }: OrderListTableProps) {
  const columns: TableColumn<Round>[] = useMemo(
    () => [
      {
        key: 'round_number',
        label: '#',
        width: 'w-12',
        render: (r) => <span className="text-gray-400">#{r.round_number}</span>,
      },
      {
        key: 'table_code',
        label: 'Mesa',
        render: (r) => <span className="font-medium text-white">{r.table_code}</span>,
      },
      {
        key: 'sector_name',
        label: 'Sector',
        render: (r) => <span className="text-gray-400">{r.sector_name ?? '—'}</span>,
      },
      {
        key: 'status',
        label: 'Estado',
        width: 'w-28',
        render: (r) => (
          <Badge variant={statusVariant(r.status)}>
            {statusLabel(r.status)}
          </Badge>
        ),
      },
      {
        key: 'items_count',
        label: 'Items',
        width: 'w-16',
        render: (r) => <span className="text-gray-400">{r.items_count}</span>,
      },
      {
        key: 'total_cents',
        label: 'Total',
        width: 'w-24',
        render: (r) => <span className="text-gray-300">{formatPrice(r.total_cents)}</span>,
      },
      {
        key: 'pending_at',
        label: 'Creada',
        width: 'w-36',
        render: (r) => <span className="text-gray-400 text-xs">{formatDate(r.pending_at)}</span>,
      },
      {
        key: 'actions',
        label: 'Acciones',
        width: 'w-20',
        render: (r) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onOpenDetail(r.id) }}
            aria-label={`Ver detalle ronda #${r.round_number}`}
          >
            <Eye className="w-4 h-4" aria-hidden="true" />
          </Button>
        ),
      },
    ],
    [onOpenDetail],
  )

  return (
    <Table
      columns={columns}
      items={rounds}
      rowKey={(r) => r.id}
      emptyMessage="No hay rondas que coincidan con los filtros."
      onRowClick={(r) => onOpenDetail(r.id)}
    />
  )
}
