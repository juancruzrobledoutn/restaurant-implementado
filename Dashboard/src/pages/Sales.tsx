/**
 * Sales — daily sales KPIs and top products page (C-16).
 *
 * Skills: dashboard-crud-page
 *
 * Features:
 * - DatePicker (default today, persisted in salesStore.selectedDate)
 * - 3 KPI cards: Revenue, Orders, Average Ticket
 * - Top products table with pagination
 * - ReceiptButton — opens printable receipt for each top-product row's check
 *   (Note: top products table doesn't have checkId; ReceiptButton is separate
 *   workflow — removed from top products to avoid incorrect assumption)
 */

import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'

import { PageContainer } from '@/components/ui/PageContainer'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { Pagination } from '@/components/ui/Pagination'
import { SalesKPICard } from '@/components/sales/SalesKPICard'

import { usePagination } from '@/hooks/usePagination'

import {
  useSalesStore,
  selectDailyKPIs,
  selectTopProducts,
  selectSalesSelectedDate,
  selectSalesIsLoading,
  useSalesActions,
} from '@/stores/salesStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { formatPrice } from '@/utils/formatPrice'
import { helpContent } from '@/utils/helpContent'

import type { TopProduct } from '@/types/operations'
import type { TableColumn } from '@/components/ui/Table'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function SalesPage() {
  const navigate = useNavigate()

  // Stores
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const daily = useSalesStore(selectDailyKPIs)
  const topProducts = useSalesStore(selectTopProducts)
  const selectedDate = useSalesStore(selectSalesSelectedDate)
  const isLoading = useSalesStore(selectSalesIsLoading)
  const { fetchDaily, fetchTopProducts, setDate } = useSalesActions()

  // Refetch on branch or date change
  useEffect(() => {
    if (!selectedBranchId) return
    void fetchDaily(selectedBranchId, selectedDate)
    void fetchTopProducts(selectedBranchId, selectedDate, 10)
  }, [selectedBranchId, selectedDate, fetchDaily, fetchTopProducts])

  // Pagination for top products table
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } =
    usePagination(topProducts)

  // ---------------------------------------------------------------------------
  // Top products columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<TopProduct>[] = useMemo(
    () => [
      {
        key: 'product_name',
        label: 'Producto',
        render: (item) => <span className="font-medium">{item.product_name}</span>,
      },
      {
        key: 'quantity_sold',
        label: 'Cantidad',
        width: 'w-24',
        render: (item) => (
          <span className="text-sm tabular-nums">{item.quantity_sold}</span>
        ),
      },
      {
        key: 'revenue_cents',
        label: 'Ingresos',
        width: 'w-32',
        render: (item) => (
          <span className="text-sm font-semibold tabular-nums">
            {formatPrice(item.revenue_cents)}
          </span>
        ),
      },
    ],
    [],
  )

  // ---------------------------------------------------------------------------
  // Branch guard
  // ---------------------------------------------------------------------------
  if (!selectedBranchId) {
    return (
      <PageContainer
        title="Ventas"
        description="Selecciona una sucursal para ver sus ventas"
        helpContent={helpContent.sales}
      >
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)] mb-4">
            Selecciona una sucursal desde el Dashboard para ver sus ventas
          </p>
          <Button onClick={() => navigate('/')}>Ir al Dashboard</Button>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title="Ventas"
      description="KPIs diarios y productos mas vendidos."
      helpContent={helpContent.sales}
    >
      {/* Date picker */}
      <div className="mb-6 flex items-center gap-3">
        <label className="text-sm font-medium text-gray-300">Fecha:</label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
          aria-label="Seleccionar fecha de ventas"
        />
        <Button variant="ghost" size="sm" onClick={() => setDate(todayISO())}>
          Hoy
        </Button>
      </div>

      {/* KPI cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-700" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
          <SalesKPICard
            label="Ingresos del dia"
            value={daily?.revenue_cents ?? 0}
            format="currency"
          />
          <SalesKPICard
            label="Ordenes"
            value={daily?.orders ?? 0}
            format="number"
          />
          <SalesKPICard
            label="Ticket promedio"
            value={daily?.average_ticket_cents ?? 0}
            format="currency"
          />
        </div>
      )}

      {/* Top products table */}
      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-4">
          Top Productos
        </h2>
        {isLoading ? (
          <TableSkeleton rows={5} columns={3} />
        ) : (
          <Table
            columns={columns}
            items={paginatedItems}
            rowKey={(item) => item.product_id}
            emptyMessage="No hay ventas registradas para este dia."
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
    </PageContainer>
  )
}
