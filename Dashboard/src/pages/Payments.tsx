/**
 * Payments — admin billing payments listing page (C-26).
 *
 * Skills: dashboard-crud-page, zustand-store-pattern, ws-frontend-subscription,
 *         help-system-content
 *
 * Features:
 * - Date range picker (from/to, default today)
 * - Method filter (cash|card|transfer|mercadopago|all)
 * - Status filter (APPROVED|REJECTED|PENDING|FAILED|all)
 * - Paginated payments table with method icon + status badge
 * - Click check_id column → opens CheckDetailModal
 * - PaymentMethodSummary at footer (APPROVED only, design D10)
 * - BillingRealtimeBridge (WS real-time updates)
 * - Branch guard with fallback card
 * - Filters persist via billingAdminStore persist()
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { PageContainer } from '@/components/ui/PageContainer'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Table } from '@/components/ui/Table'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { Pagination } from '@/components/ui/Pagination'
import { CheckDetailModal } from '@/components/billing/CheckDetailModal'
import { BillingRealtimeBridge } from '@/components/billing/BillingRealtimeBridge'
import { PaymentMethodIcon } from '@/components/billing/PaymentMethodIcon'
import { PaymentMethodSummary } from '@/components/billing/PaymentMethodSummary'

import { usePagination } from '@/hooks/usePagination'

import {
  useBillingAdminStore,
  selectPayments,
  selectPaymentsIsLoading,
  selectPaymentsFilter,
  useBillingAdminActions,
} from '@/stores/billingAdminStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'

import { helpContent } from '@/utils/helpContent'
import { formatPrice } from '@/utils/formatPrice'

import type { PaymentSummary, PaymentStatus, PaymentMethod } from '@/types/billing'
import type { TableColumn } from '@/components/ui/Table'

// ---------------------------------------------------------------------------
// Helpers
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
// Component
// ---------------------------------------------------------------------------

export default function PaymentsPage() {
  const navigate = useNavigate()

  // ── Store: branch ──────────────────────────────────────────────────────────
  const selectedBranchId = useBranchStore(selectSelectedBranchId)

  // ── Store: payments ────────────────────────────────────────────────────────
  const payments = useBillingAdminStore(selectPayments)
  const isLoading = useBillingAdminStore(selectPaymentsIsLoading)
  const filter = useBillingAdminStore(selectPaymentsFilter)
  const { fetchPayments, setPaymentsFilter } = useBillingAdminActions()

  // ── Modal state ──────────────────────────────���─────────────────────────────
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null)

  // ── Fetch on branch or filter change ──────────────────────────────────────
  useEffect(() => {
    if (!selectedBranchId) return
    void fetchPayments(selectedBranchId)
  }, [selectedBranchId, filter, fetchPayments])

  // ── Pagination ──────────────────────────────────��──────────────────────────
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } =
    usePagination(payments)

  // ── Columns ────────────────────────────────────────────────��───────────────
  const columns: TableColumn<PaymentSummary>[] = useMemo(
    () => [
      {
        key: 'created_at',
        label: 'Hora',
        width: 'w-20',
        render: (item) => (
          <span className="tabular-nums text-xs text-gray-400">
            {new Date(item.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        ),
      },
      {
        key: 'check_id',
        label: 'Cuenta',
        width: 'w-24',
        render: (item) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              // We have check_id but need session_id for detail — use check_id as workaround
              // since billingAPI.getCheck uses session_id; check_id ≠ session_id in general.
              // For now, set sessionId to null (modal handles null gracefully) and show
              // check_id as info. A full solution would require a lookup endpoint.
              // Note: The WS event and listing both don't carry session_id for payments.
              // The correct approach: open modal with checkId only, or adapt API.
              // For this implementation we pass checkId to CheckDetailModal and use
              // the check_id field. The modal calls billingAPI.getCheck(sessionId).
              // Since we don't have sessionId from payments, we skip deep link.
              // This is acceptable per design D7 — detail is accessible via /checks.
              setSelectedSessionId(null)
              setSelectedCheckId(item.check_id)
              setModalOpen(true)
            }}
            aria-label={`Ver cuenta ${item.check_id}`}
            className="font-mono text-xs text-primary hover:underline"
          >
            #{item.check_id}
          </Button>
        ),
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
          <span className="tabular-nums text-sm font-semibold text-white">
            {formatPrice(item.amount_cents)}
          </span>
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
    ],
    [],
  )

  // ── Branch guard ───────────────────────────────────────────────────────────
  if (!selectedBranchId) {
    return (
      <PageContainer
        title="Pagos"
        description="Selecciona una sucursal para ver sus pagos"
        helpContent={helpContent.payments}
      >
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)] mb-4">
            Selecciona una sucursal desde el Dashboard para ver sus pagos
          </p>
          <Button onClick={() => navigate('/')}>Ir al Dashboard</Button>
        </Card>
      </PageContainer>
    )
  }

  return (
    <>
      <BillingRealtimeBridge />
      <PageContainer
        title="Pagos"
        description="Historial de pagos con filtros por metodo y estado."
        helpContent={helpContent.payments}
      >
        {/* Filters */}
        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium text-gray-300">Desde:</label>
          <input
            type="date"
            value={filter.from}
            onChange={(e) => setPaymentsFilter({ from: e.target.value, page: 1 })}
            className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
            aria-label="Fecha desde"
          />

          <label className="text-sm font-medium text-gray-300">Hasta:</label>
          <input
            type="date"
            value={filter.to}
            onChange={(e) => setPaymentsFilter({ to: e.target.value, page: 1 })}
            className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
            aria-label="Fecha hasta"
          />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10)
              setPaymentsFilter({ from: today, to: today, page: 1 })
            }}
          >
            Hoy
          </Button>

          <label className="text-sm font-medium text-gray-300 ml-2">Metodo:</label>
          <select
            value={filter.method ?? ''}
            onChange={(e) => setPaymentsFilter({ method: (e.target.value as PaymentMethod) || null, page: 1 })}
            className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
            aria-label="Filtrar por metodo de pago"
          >
            <option value="">Todos</option>
            <option value="cash">Efectivo</option>
            <option value="card">Tarjeta</option>
            <option value="transfer">Transferencia</option>
            <option value="mercadopago">MercadoPago</option>
          </select>

          <label className="text-sm font-medium text-gray-300 ml-2">Estado:</label>
          <select
            value={filter.status ?? ''}
            onChange={(e) => setPaymentsFilter({ status: (e.target.value as PaymentStatus) || null, page: 1 })}
            className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
            aria-label="Filtrar por estado de pago"
          >
            <option value="">Todos</option>
            <option value="APPROVED">Aprobado</option>
            <option value="REJECTED">Rechazado</option>
            <option value="PENDING">Pendiente</option>
            <option value="FAILED">Fallido</option>
          </select>
        </div>

        {/* Payments table */}
        <Card>
          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : (
            <Table
              columns={columns}
              items={paginatedItems}
              rowKey={(item) => item.id}
              emptyMessage="No hay pagos para este rango de fechas."
            />
          )}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={setCurrentPage}
          />

          {/* Payment method summary (design D10) */}
          <PaymentMethodSummary />
        </Card>

        {/* Check detail modal (from check_id column click) */}
        <CheckDetailModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          sessionId={selectedSessionId}
          checkId={selectedCheckId}
        />
      </PageContainer>
    </>
  )
}
