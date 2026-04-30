/**
 * Checks — admin billing checks listing page (C-26).
 *
 * Skills: dashboard-crud-page, zustand-store-pattern, ws-frontend-subscription,
 *         help-system-content
 *
 * Features:
 * - DatePicker (today default, persisted in store)
 * - Status filter (REQUESTED | PAID | all)
 * - 3 KPI cards: total checks, total billed, pending checks
 * - Paginated table with CheckStatusBadge, Ver detalle, Imprimir actions
 * - CheckDetailModal (lazy-fetched on open)
 * - BillingRealtimeBridge (WS real-time updates)
 * - Branch guard with fallback card
 * - ADMIN/MANAGER only (router RoleGuard enforces)
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { PageContainer } from '@/components/ui/PageContainer'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { Pagination } from '@/components/ui/Pagination'
import { SalesKPICard } from '@/components/sales/SalesKPICard'
import { CheckStatusBadge } from '@/components/billing/CheckStatusBadge'
import { CheckDetailModal } from '@/components/billing/CheckDetailModal'
import { BillingRealtimeBridge } from '@/components/billing/BillingRealtimeBridge'

import { usePagination } from '@/hooks/usePagination'

import {
  useBillingAdminStore,
  selectChecks,
  selectChecksIsLoading,
  selectChecksFilter,
  useChecksKPIs,
  useBillingAdminActions,
} from '@/stores/billingAdminStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'

import { helpContent } from '@/utils/helpContent'
import { formatPrice } from '@/utils/formatPrice'

import type { CheckSummary, CheckStatus } from '@/types/billing'
import type { TableColumn } from '@/components/ui/Table'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChecksPage() {
  const navigate = useNavigate()

  // ── Store: branch ────────────────────────────────���─────────────────────────
  const selectedBranchId = useBranchStore(selectSelectedBranchId)

  // ── Store: billing checks ────────────────────────────��────────────────────
  const checks = useBillingAdminStore(selectChecks)
  const isLoading = useBillingAdminStore(selectChecksIsLoading)
  const filter = useBillingAdminStore(selectChecksFilter)
  const kpis = useChecksKPIs()
  const { fetchChecks, setChecksFilter } = useBillingAdminActions()

  // ── Modal state ────────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null)

  // ── Fetch on branch or filter change ──────────────────────────────────────
  useEffect(() => {
    if (!selectedBranchId) return
    void fetchChecks(selectedBranchId)
  }, [selectedBranchId, filter, fetchChecks])

  // ── Pagination ─────────────────────────────────────────────────────────────
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } =
    usePagination(checks)

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns: TableColumn<CheckSummary>[] = useMemo(
    () => [
      {
        key: 'created_at',
        label: 'Hora',
        width: 'w-24',
        render: (item) => (
          <span className="tabular-nums text-xs text-gray-400">
            {new Date(item.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'Estado',
        width: 'w-28',
        render: (item) => <CheckStatusBadge status={item.status} />,
      },
      {
        key: 'total_cents',
        label: 'Total',
        width: 'w-28',
        render: (item) => (
          <span className="tabular-nums text-sm font-semibold text-white">
            {formatPrice(item.total_cents)}
          </span>
        ),
      },
      {
        key: 'covered_cents',
        label: 'Cubierto',
        width: 'w-28',
        render: (item) => (
          <span className="tabular-nums text-sm text-gray-300">
            {formatPrice(item.covered_cents)}
          </span>
        ),
      },
      {
        key: 'actions',
        label: 'Acciones',
        width: 'w-32',
        render: (item) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                setSelectedSessionId(item.session_id)
                setSelectedCheckId(item.id)
                setModalOpen(true)
              }}
              aria-label={`Ver detalle de cuenta ${item.id}`}
            >
              Ver
            </Button>
          </div>
        ),
      },
    ],
    [],
  )

  // ── Branch guard ───────────────────────────────────────────────────────────
  if (!selectedBranchId) {
    return (
      <PageContainer
        title="Cuentas"
        description="Selecciona una sucursal para ver sus cuentas"
        helpContent={helpContent.checks}
      >
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)] mb-4">
            Selecciona una sucursal desde el Dashboard para ver sus cuentas
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
        title="Cuentas"
        description="Listado de cuentas del dia con KPIs operativos."
        helpContent={helpContent.checks}
      >
        {/* Date filter */}
        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium text-gray-300">Fecha:</label>
          <input
            type="date"
            value={filter.date}
            onChange={(e) => setChecksFilter({ date: e.target.value, page: 1 })}
            className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
            aria-label="Seleccionar fecha de cuentas"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChecksFilter({ date: new Date().toISOString().slice(0, 10), page: 1 })}
          >
            Hoy
          </Button>

          <label className="text-sm font-medium text-gray-300 ml-4">Estado:</label>
          <select
            value={filter.status ?? ''}
            onChange={(e) => setChecksFilter({ status: (e.target.value as CheckStatus) || null, page: 1 })}
            className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
            aria-label="Filtrar por estado de cuenta"
          >
            <option value="">Todos</option>
            <option value="REQUESTED">Pendiente</option>
            <option value="PAID">Pagada</option>
          </select>
        </div>

        {/* KPI cards (design D6: computed client-side) */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-700" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
            <SalesKPICard
              label="Cuentas del dia"
              value={kpis.totalChecks}
              format="number"
            />
            <SalesKPICard
              label="Total facturado"
              value={kpis.totalBilledCents}
              format="currency"
            />
            <SalesKPICard
              label="Cuentas pendientes"
              value={kpis.pendingChecks}
              format="number"
            />
          </div>
        )}

        {/* Checks table */}
        <Card>
          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : (
            <Table
              columns={columns}
              items={paginatedItems}
              rowKey={(item) => item.id}
              emptyMessage="No hay cuentas para este dia."
            />
          )}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={setCurrentPage}
          />
        </Card>

        {/* Check detail modal */}
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
