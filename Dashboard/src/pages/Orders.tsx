/**
 * Orders — admin round management page (C-25).
 *
 * Skills: dashboard-crud-page, zustand-store-pattern, ws-frontend-subscription
 *
 * Features:
 *   - Column (kanban) view: one column per RoundStatus
 *   - List view: paginated Table
 *   - Sticky filter bar: date, sector, status, table_code (debounced)
 *   - Detail modal: OrderDetailsModal
 *   - Cancel flow: CancelOrderDialog → cancelRound API → wait for WS ROUND_CANCELED
 *   - Real-time WS sync: useRoundsAdminWebSocketSync
 *   - viewMode persisted to localStorage key 'orders.viewMode'
 *   - RBAC: only ADMIN and MANAGER can cancel rounds
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { LayoutList, Columns } from 'lucide-react'

import { PageContainer } from '@/components/ui/PageContainer'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { TableSkeleton } from '@/components/ui/TableSkeleton'

import { OrderFilters } from '@/components/orders/OrderFilters'
import { OrderColumn } from '@/components/orders/OrderColumn'
import { OrderListTable } from '@/components/orders/OrderListTable'
import { OrderDetailsModal } from '@/components/orders/OrderDetailsModal'
import { CancelOrderDialog } from '@/components/orders/CancelOrderDialog'

import { useRoundsAdminWebSocketSync } from '@/hooks/useRoundsAdminWebSocketSync'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'

import {
  useRoundsAdminStore,
  selectAdminRounds,
  selectRoundsLoading,
  selectRoundsError,
  selectRoundsFilters,
  selectRoundsTotal,
  selectSelectedRoundId,
  selectSelectedRound,
  useRoundsAdminActions,
  EMPTY_ROUNDS,
} from '@/stores/roundsAdminStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { useSectorStore } from '@/stores/sectorStore'
import { toast } from '@/stores/toastStore'
import { helpContent } from '@/utils/helpContent'

import type { RoundFilters, RoundStatus, ViewMode } from '@/types/operations'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEW_MODE_KEY = 'orders.viewMode'

const ALL_STATUSES: RoundStatus[] = [
  'PENDING', 'CONFIRMED', 'SUBMITTED', 'IN_KITCHEN', 'READY', 'SERVED', 'CANCELED',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    return stored === 'list' ? 'list' : 'columns'
  } catch {
    return 'columns'
  }
}

function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode)
  } catch {
    // localStorage may be unavailable in some environments
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function OrdersPage() {
  const navigate = useNavigate()

  // ── Stores ──────────────────────────────────────────────────────────────
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const rounds = useRoundsAdminStore(selectAdminRounds)
  const isLoading = useRoundsAdminStore(selectRoundsLoading)
  const error = useRoundsAdminStore(selectRoundsError)
  const filters = useRoundsAdminStore(selectRoundsFilters)
  const total = useRoundsAdminStore(selectRoundsTotal)
  const selectedRoundId = useRoundsAdminStore(selectSelectedRoundId)
  const selectedRound = useRoundsAdminStore(selectSelectedRound)

  const { fetchRounds, setFilter, clearFilters, selectRound, cancelRound, reset } =
    useRoundsAdminActions()

  // ── RBAC ────────────────────────────────────────────────────────────────
  const { canEdit } = useAuthPermissions()  // ADMIN + MANAGER
  const canCancel = canEdit

  // ── View mode ───────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)

  const handleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    saveViewMode(mode)
  }, [])

  // ── Cancel dialog ───────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const [isCanceling, setIsCanceling] = useState(false)

  const cancelTargetRound = useMemo(
    () => rounds.find((r) => r.id === cancelTarget) ?? null,
    [rounds, cancelTarget],
  )

  // ── Real-time WS ─────────────────────────────────────────────────────────
  useRoundsAdminWebSocketSync(selectedBranchId)

  // ── Sync branch_id filter & fetch on branch change ───────────────────────
  useEffect(() => {
    if (!selectedBranchId) return
    const newFilters: Partial<RoundFilters> = { branch_id: selectedBranchId }
    void fetchRounds(newFilters)
  }, [selectedBranchId, fetchRounds])

  // Fetch sectors for the filter bar when branch changes
  useEffect(() => {
    if (!selectedBranchId) return
    void useSectorStore.getState().fetchByBranch(selectedBranchId)
  }, [selectedBranchId])

  // Reset store on unmount to avoid stale data on next visit
  useEffect(() => {
    return () => reset()
  }, [reset])

  // ── Filter handlers ──────────────────────────────────────────────────────

  const handleFilterChange = useCallback(
    <K extends keyof RoundFilters>(key: K, value: RoundFilters[K] | undefined) => {
      setFilter(key, value)
      const updated: Partial<RoundFilters> = { ...filters, [key]: value, offset: 0 }
      void fetchRounds(updated)
    },
    [filters, setFilter, fetchRounds],
  )

  const handleClear = useCallback(() => {
    clearFilters()
    void fetchRounds({ branch_id: selectedBranchId ?? '', offset: 0 })
  }, [clearFilters, fetchRounds, selectedBranchId])

  const handleRefresh = useCallback(() => {
    void fetchRounds(filters)
  }, [fetchRounds, filters])

  // ── Detail handlers ──────────────────────────────────────────────────────

  const handleOpenDetail = useCallback((id: string) => {
    selectRound(id)
  }, [selectRound])

  const handleCloseDetail = useCallback(() => {
    selectRound(null)
  }, [selectRound])

  // ── Cancel handlers ──────────────────────────────────────────────────────

  const handleCancelRequest = useCallback((roundId: string) => {
    handleCloseDetail()
    setCancelTarget(roundId)
  }, [handleCloseDetail])

  const handleCancelConfirm = useCallback(async (reason: string) => {
    if (!cancelTarget) return
    setIsCanceling(true)
    try {
      await cancelRound(cancelTarget, reason)
      setCancelTarget(null)
      toast.success('Ronda cancelada. Esperando confirmacion...')
    } catch {
      toast.error('Error al cancelar la ronda. Intenta de nuevo.')
    } finally {
      setIsCanceling(false)
    }
  }, [cancelTarget, cancelRound])

  const handleCancelDialogClose = useCallback(() => {
    if (!isCanceling) setCancelTarget(null)
  }, [isCanceling])

  // ── Column view: split rounds by status ─────────────────────────────────
  const roundsByStatus = useMemo(() => {
    const map = new Map<RoundStatus, typeof rounds>()
    for (const status of ALL_STATUSES) map.set(status, EMPTY_ROUNDS)
    for (const round of rounds) {
      const existing = map.get(round.status) ?? []
      map.set(round.status, [...existing, round])
    }
    return map
  }, [rounds])

  // ── Branch guard ─────────────────────────────────────────────────────────
  if (!selectedBranchId) {
    return (
      <PageContainer
        title="Pedidos"
        description="Gestion de rondas por estado"
        helpContent={helpContent.orders}
      >
        <Card className="text-center py-12">
          <p className="text-gray-400 mb-4">
            Selecciona una sucursal desde el Dashboard para ver los pedidos
          </p>
          <Button onClick={() => navigate('/')}>Ir al Dashboard</Button>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title="Pedidos"
      description={`${total} ronda${total !== 1 ? 's' : ''} — actualizado en tiempo real`}
      helpContent={helpContent.orders}
      actions={
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <Button
            variant={viewMode === 'columns' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => handleViewMode('columns')}
            aria-label="Vista columnas"
            aria-pressed={viewMode === 'columns'}
            title="Vista kanban"
          >
            <Columns className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => handleViewMode('list')}
            aria-label="Vista lista"
            aria-pressed={viewMode === 'list'}
            title="Vista lista"
          >
            <LayoutList className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      }
    >
      {/* Filters */}
      <OrderFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        onClear={handleClear}
        onRefresh={handleRefresh}
        isLoading={isLoading}
      />

      {/* Error state */}
      {error && (
        <Card className="border-red-700 bg-red-900/20">
          <p className="text-red-300 text-sm">{error}</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={handleRefresh}>
            Reintentar
          </Button>
        </Card>
      )}

      {/* Loading state */}
      {isLoading && rounds.length === 0 && (
        <TableSkeleton columns={5} rows={6} />
      )}

      {/* Empty state */}
      {!isLoading && !error && rounds.length === 0 && (
        <Card className="text-center py-12">
          <p className="text-gray-400">
            No hay rondas que coincidan con los filtros aplicados.
          </p>
        </Card>
      )}

      {/* Content — columns or list */}
      {rounds.length > 0 && (
        <>
          {viewMode === 'columns' ? (
            <div
              className="flex gap-3 overflow-x-auto pb-4"
              style={{ minHeight: '60vh' }}
              role="region"
              aria-label="Vista kanban de rondas"
            >
              {ALL_STATUSES.map((status) => (
                <div key={status} className="min-w-[220px] max-w-[280px] flex-shrink-0">
                  <OrderColumn
                    status={status}
                    rounds={roundsByStatus.get(status) ?? EMPTY_ROUNDS}
                    onOpenDetail={handleOpenDetail}
                  />
                </div>
              ))}
            </div>
          ) : (
            <OrderListTable rounds={rounds} onOpenDetail={handleOpenDetail} />
          )}
        </>
      )}

      {/* Detail modal */}
      <OrderDetailsModal
        round={selectedRound}
        isOpen={selectedRoundId !== null}
        onClose={handleCloseDetail}
        canCancel={canCancel}
        onCancel={handleCancelRequest}
      />

      {/* Cancel dialog */}
      <CancelOrderDialog
        isOpen={cancelTarget !== null}
        onClose={handleCancelDialogClose}
        onConfirm={handleCancelConfirm}
        roundNumber={cancelTargetRound?.round_number ?? null}
        isLoading={isCanceling}
      />
    </PageContainer>
  )
}
