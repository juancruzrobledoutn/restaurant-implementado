/**
 * CheckDetailModal — shows full check detail with charges, allocations, payments (C-26).
 *
 * Skills: dashboard-crud-page, help-system-content
 *
 * Fetches on open via billingAPI.getCheck(sessionId).
 * Has HelpButton (size="sm") as first element.
 * Footer: "Imprimir recibo" button.
 *
 * Design D7: lazy load — fetch only when modal opens.
 */

import { useEffect, useState } from 'react'

import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { HelpButton } from '@/components/ui/HelpButton'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { Table } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'

import { billingAPI } from '@/services/billingAPI'
import { receiptAPI } from '@/services/receiptAPI'
import { handleError } from '@/utils/logger'
import { formatPrice } from '@/utils/formatPrice'
import { PaymentMethodIcon } from '@/components/billing/PaymentMethodIcon'

import type { CheckDetail, ChargeDetail, PaymentDetail } from '@/services/billingAPI'
import type { TableColumn } from '@/components/ui/Table'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CheckDetailModalProps {
  isOpen: boolean
  onClose: () => void
  /** Table session ID — used to call GET /api/billing/check/{session_id} */
  sessionId: string | null
  /** Check ID — used for receipt printing */
  checkId: string | null
}

// ---------------------------------------------------------------------------
// Payment status badge variant helper
// ---------------------------------------------------------------------------

function paymentStatusVariant(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (status) {
    case 'APPROVED': return 'success'
    case 'REJECTED':
    case 'FAILED': return 'danger'
    case 'PENDING': return 'warning'
    default: return 'neutral'
  }
}

function paymentStatusLabel(status: string): string {
  switch (status) {
    case 'APPROVED': return 'Aprobado'
    case 'REJECTED': return 'Rechazado'
    case 'FAILED': return 'Fallido'
    case 'PENDING': return 'Pendiente'
    default: return status
  }
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const chargeColumns: TableColumn<ChargeDetail>[] = [
  {
    key: 'id',
    label: 'ID',
    width: 'w-16',
    render: (item) => <span className="tabular-nums text-xs text-gray-400">#{item.id}</span>,
  },
  {
    key: 'description',
    label: 'Descripcion',
    render: (item) => (
      <span className="text-sm text-gray-200">{item.description ?? '—'}</span>
    ),
  },
  {
    key: 'amount_cents',
    label: 'Monto',
    width: 'w-28',
    render: (item) => (
      <span className="tabular-nums text-sm font-semibold">{formatPrice(item.amount_cents)}</span>
    ),
  },
  {
    key: 'remaining_cents',
    label: 'Pendiente',
    width: 'w-28',
    render: (item) => (
      <span className={`tabular-nums text-sm font-semibold ${item.remaining_cents > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
        {formatPrice(item.remaining_cents)}
      </span>
    ),
  },
]

const paymentColumns: TableColumn<PaymentDetail>[] = [
  {
    key: 'id',
    label: 'ID',
    width: 'w-16',
    render: (item) => <span className="tabular-nums text-xs text-gray-400">#{item.id}</span>,
  },
  {
    key: 'method',
    label: 'Metodo',
    width: 'w-36',
    render: (item) => <PaymentMethodIcon method={item.method} />,
  },
  {
    key: 'amount_cents',
    label: 'Monto',
    width: 'w-28',
    render: (item) => (
      <span className="tabular-nums text-sm font-semibold">{formatPrice(item.amount_cents)}</span>
    ),
  },
  {
    key: 'status',
    label: 'Estado',
    width: 'w-28',
    render: (item) => (
      <Badge variant={paymentStatusVariant(item.status)}>
        {paymentStatusLabel(item.status)}
      </Badge>
    ),
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CheckDetailModal({ isOpen, onClose, sessionId, checkId }: CheckDetailModalProps) {
  const [detail, setDetail] = useState<CheckDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)

  // Fetch detail on open
  useEffect(() => {
    if (!isOpen || !sessionId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setIsLoading(true)
    billingAPI
      .getCheck(sessionId)
      .then((data) => {
        if (!cancelled) {
          setDetail(data)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          handleError(err, 'CheckDetailModal.getCheck')
          setIsLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [isOpen, sessionId])

  async function handlePrint() {
    if (!checkId) return
    setIsPrinting(true)
    try {
      await receiptAPI.openReceipt(checkId)
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Detalle de Cuenta"
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          {checkId && (
            <Button
              variant="primary"
              onClick={() => void handlePrint()}
              isLoading={isPrinting}
              disabled={isPrinting}
            >
              Imprimir recibo
            </Button>
          )}
        </>
      }
    >
      {/* HelpButton — mandatory first element (skill: help-system-content) */}
      <div className="flex items-center gap-2 mb-4">
        <HelpButton
          title="Detalle de Cuenta"
          size="sm"
          content={
            <div className="space-y-3">
              <p><strong>Cargos:</strong> Los montos que cada comensal debe cubrir en esta cuenta.</p>
              <p><strong>Asignaciones:</strong> Los pagos aplicados a cada cargo via el sistema FIFO.</p>
              <p><strong>Pagos:</strong> Los pagos registrados para esta cuenta (efectivo, tarjeta, MP, etc.).</p>
              <div className="bg-zinc-800 p-3 rounded-lg mt-3">
                <p className="text-orange-400 font-medium text-sm">Nota:</p>
                <p className="text-sm mt-1">
                  El campo "Pendiente" en Cargos muestra cuanto falta cubrir en cada cargo.
                  Cuando es $0.00, el cargo esta cubierto.
                </p>
              </div>
            </div>
          }
        />
        <span className="text-sm text-gray-400">Ayuda sobre el detalle</span>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <TableSkeleton rows={3} columns={4} />
          <TableSkeleton rows={2} columns={4} />
        </div>
      ) : detail ? (
        <div className="space-y-6">
          {/* Summary header */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wide">Total cuenta</p>
              <p className="text-xl font-bold text-white tabular-nums mt-1">
                {formatPrice(detail.total_cents)}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wide">Estado</p>
              <p className={`text-sm font-semibold mt-1 ${detail.status === 'PAID' ? 'text-green-400' : 'text-yellow-400'}`}>
                {detail.status === 'PAID' ? 'Pagada' : 'Pendiente'}
              </p>
            </div>
          </div>

          {/* Charges table */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Cargos ({detail.charges.length})
            </h3>
            <Table
              columns={chargeColumns}
              items={detail.charges}
              rowKey={(item) => item.id}
              emptyMessage="Sin cargos registrados."
            />
          </section>

          {/* Payments table */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Pagos ({detail.payments.length})
            </h3>
            <Table
              columns={paymentColumns}
              items={detail.payments}
              rowKey={(item) => item.id}
              emptyMessage="Sin pagos registrados."
            />
          </section>
        </div>
      ) : (
        <p className="text-gray-400 text-sm text-center py-8">No se pudo cargar el detalle.</p>
      )}
    </Modal>
  )
}
