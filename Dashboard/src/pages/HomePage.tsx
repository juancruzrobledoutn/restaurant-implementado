/**
 * HomePage — operational dashboard for the selected branch (C-30).
 *
 * Skills: zustand-store-pattern, ws-frontend-subscription, help-system-content,
 *         vercel-react-best-practices, interface-design
 *
 * Two exclusive states:
 * 1. No branch selected → HomeEmptyBranchState (CTA to open BranchSwitcher)
 * 2. Branch selected    → PageContainer with 4 KPIs + 5 quick-links
 *
 * Data flow:
 * - KPIs derived from tableStore (items) and salesStore (daily) — no new store
 * - WS: useTableWebSocketSync patches table status in real-time
 * - WS: useSalesWebSocketRefresh triggers throttled re-fetch on financial events
 * - Fetch triggered on mount + branch change (early return if no branch)
 *
 * Rules enforced:
 * - No store destructuring — only named selectors
 * - No inline ?? [] fallbacks — all empty arrays are module-level constants
 * - useShallow only where selectors return objects/arrays
 * - Home always fetches TODAY — never overwrites Sales page's selectedDate
 */

import { useEffect } from 'react'
import {
  useBranchStore,
  selectSelectedBranch,
  selectSelectedBranchId,
} from '@/stores/branchStore'
import {
  useTableStore,
  selectTables,
  selectActiveTablesCount,
  selectTotalTablesCount,
  useTableActions,
} from '@/stores/tableStore'
import {
  useSalesStore,
  selectDailyKPIs,
  selectSalesIsLoading,
  useSalesActions,
} from '@/stores/salesStore'
import { useTableWebSocketSync } from '@/hooks/useTableWebSocketSync'
import { useSalesWebSocketRefresh } from '@/hooks/useSalesWebSocketRefresh'
import { PageContainer } from '@/components/ui/PageContainer'
import { HomeEmptyBranchState } from '@/components/home/HomeEmptyBranchState'
import { HomeKPIGrid } from '@/components/home/HomeKPIGrid'
import { HomeQuickLinks } from '@/components/home/HomeQuickLinks'
import { helpContent } from '@/utils/helpContent'

// ---------------------------------------------------------------------------
// Date helpers — always uses client local date (same convention as Sales.tsx)
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDateEs(date: Date): string {
  return date.toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// HomePage
// ---------------------------------------------------------------------------

export default function HomePage() {
  // Branch state — primitives → plain selectors (no useShallow needed)
  const selectedBranch = useBranchStore(selectSelectedBranch)
  const selectedBranchId = useBranchStore(selectSelectedBranchId)

  // Table state — scalars derived inside store selectors (return primitives)
  const tables = useTableStore(selectTables)
  const activeTables = useTableStore(selectActiveTablesCount)
  const totalTables = useTableStore(selectTotalTablesCount)

  // Sales state — daily is a single object replaced atomically; no useShallow needed
  const daily = useSalesStore(selectDailyKPIs)
  const isLoadingSales = useSalesStore(selectSalesIsLoading)

  // Actions — useShallow inside the action hook, no destructuring here
  const { fetchByBranch } = useTableActions()
  const { fetchDaily } = useSalesActions()

  // WS subscriptions — ref pattern, returns unsubscribe on unmount
  useTableWebSocketSync(selectedBranchId)
  useSalesWebSocketRefresh(selectedBranchId, todayISO())

  // Fetch on mount / branch change
  useEffect(() => {
    if (!selectedBranchId) return

    // Fetch tables only if none loaded yet for this branch (avoid redundant API call)
    if (tables.length === 0) {
      void fetchByBranch(selectedBranchId)
    }

    // Always fetch today's KPIs — home always shows TODAY, not salesStore.selectedDate
    void fetchDaily(selectedBranchId, todayISO())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId])

  // ---------------------------------------------------------------------------
  // Render: empty state when no branch selected
  // ---------------------------------------------------------------------------
  if (!selectedBranch) {
    return (
      <div className="p-6">
        <HomeEmptyBranchState />
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: operational home with KPIs + quick-links
  // ---------------------------------------------------------------------------
  const todayFormatted = formatDateEs(new Date())

  return (
    <PageContainer
      title={selectedBranch.name}
      description={todayFormatted}
      helpContent={helpContent.home}
    >
      <HomeKPIGrid
        activeTables={activeTables}
        totalTables={totalTables}
        orders={daily?.orders ?? null}
        revenueCents={daily?.revenue_cents ?? null}
        averageTicketCents={daily?.average_ticket_cents ?? null}
        isLoadingSales={isLoadingSales}
      />

      <HomeQuickLinks />
    </PageContainer>
  )
}
