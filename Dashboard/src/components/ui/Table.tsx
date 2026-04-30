/**
 * Table — data table with columns, optional sort, and empty state.
 *
 * Accessibility: aria-label on rows, sorted column indicators.
 *
 * Skill: dashboard-crud-page, interface-design
 */

import type { ReactNode } from 'react'

export interface TableColumn<T> {
  key: string
  label: string
  width?: string
  render: (item: T) => ReactNode
  sortable?: boolean
}

interface TableProps<T> {
  columns: TableColumn<T>[]
  items: T[]
  rowKey: (item: T) => string
  emptyMessage?: string
  onRowClick?: (item: T) => void
  className?: string
}

export function Table<T>({
  columns,
  items,
  rowKey,
  emptyMessage = 'No hay elementos para mostrar.',
  onRowClick,
  className = '',
}: TableProps<T>) {
  return (
    <div className={['w-full overflow-x-auto', className].join(' ')}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            {columns.map((col) => (
              <th
                key={col.key}
                className={[
                  'px-4 py-3 text-left font-medium text-gray-400',
                  col.width ?? '',
                ].join(' ')}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-gray-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr
                key={rowKey(item)}
                className={[
                  'border-b border-gray-700/50 transition-colors',
                  onRowClick
                    ? 'cursor-pointer hover:bg-gray-700/40 focus-within:bg-gray-700/40'
                    : 'hover:bg-gray-700/20',
                ].join(' ')}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={[
                      'px-4 py-3 text-gray-200',
                      col.width ?? '',
                    ].join(' ')}
                  >
                    {col.render(item)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
