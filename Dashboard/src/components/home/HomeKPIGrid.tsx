/**
 * HomeKPIGrid — renders 4 operational KPI cards for the Home page (C-30).
 *
 * Skills: interface-design, vercel-react-best-practices
 *
 * Props:
 *   activeTables       — count of OCCUPIED + is_active tables
 *   totalTables        — count of all is_active tables
 *   orders             — daily order count (null while loading)
 *   revenueCents       — daily revenue in integer cents (null while loading)
 *   averageTicketCents — daily average ticket in integer cents (null while loading)
 *   isLoadingSales     — true while salesStore is fetching; shows "—" for sales KPIs
 *
 * Layout: responsive grid — 1 col mobile → 2 cols sm → 4 cols xl
 */

import { Table2, ShoppingBag, Banknote, Receipt } from 'lucide-react'
import { SalesKPICard } from '@/components/sales/SalesKPICard'

interface HomeKPIGridProps {
  activeTables: number
  totalTables: number
  orders: number | null
  revenueCents: number | null
  averageTicketCents: number | null
  isLoadingSales: boolean
}

const LOADING_PLACEHOLDER = '—'

export function HomeKPIGrid({
  activeTables,
  totalTables,
  orders,
  revenueCents,
  averageTicketCents,
  isLoadingSales,
}: HomeKPIGridProps) {
  const salesLoading = isLoadingSales && orders === null

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {/* Mesas activas — derived from tableStore (always up-to-date via WS) */}
      <SalesKPICard
        label="Mesas activas"
        value={activeTables}
        format="number"
        displayValue={`${activeTables}/${totalTables}`}
        icon={Table2}
      />

      {/* Pedidos del dia */}
      <SalesKPICard
        label="Pedidos del dia"
        value={orders ?? 0}
        format="number"
        displayValue={salesLoading ? LOADING_PLACEHOLDER : undefined}
        icon={ShoppingBag}
      />

      {/* Ingresos del dia */}
      <SalesKPICard
        label="Ingresos del dia"
        value={revenueCents ?? 0}
        format="currency"
        displayValue={salesLoading ? LOADING_PLACEHOLDER : undefined}
        icon={Banknote}
      />

      {/* Ticket promedio */}
      <SalesKPICard
        label="Ticket promedio"
        value={averageTicketCents ?? 0}
        format="currency"
        displayValue={salesLoading ? LOADING_PLACEHOLDER : undefined}
        icon={Receipt}
      />
    </div>
  )
}
