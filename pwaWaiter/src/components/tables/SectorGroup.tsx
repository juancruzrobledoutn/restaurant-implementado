/**
 * SectorGroup — visual grouping of tables under a sector header.
 *
 * In C-20 the waiter only sees their assigned sector, but the component
 * supports future multi-sector layouts (M:N assignments).
 */
import type { Table } from '@/types/table'
import { TableCard } from './TableCard'

interface Props {
  sectorName: string
  tables: Table[]
  onTableClick?: (tableId: string) => void
}

export function SectorGroup({ sectorName, tables, onTableClick }: Props) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-gray-800">{sectorName}</h2>
      {tables.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
          No hay mesas en este sector todavía.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {tables.map((table) => (
            <TableCard key={table.id} table={table} onClick={onTableClick} />
          ))}
        </div>
      )}
    </section>
  )
}
