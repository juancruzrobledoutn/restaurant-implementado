/**
 * TableSkeleton — placeholder rows shown while isLoading=true.
 *
 * Skill: dashboard-crud-page
 */

interface TableSkeletonProps {
  rows?: number
  columns?: number
  className?: string
}

export function TableSkeleton({ rows = 10, columns = 4, className = '' }: TableSkeletonProps) {
  return (
    <div className={['w-full overflow-x-auto', className].join(' ')} aria-label="Cargando datos..." aria-busy="true">
      <table className="w-full border-collapse text-sm" role="presentation">
        <tbody>
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <tr key={rowIdx} className="border-b border-gray-800">
              {Array.from({ length: columns }).map((_, colIdx) => (
                <td key={colIdx} className="px-4 py-3">
                  <div
                    className="h-4 rounded bg-gray-800 animate-pulse"
                    style={{ width: `${60 + Math.random() * 30}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
