/**
 * Pagination — page navigation controls.
 *
 * Skill: dashboard-crud-page
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'

interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  onPageChange: (page: number) => void
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null

  const from = (currentPage - 1) * itemsPerPage + 1
  const to = Math.min(currentPage * itemsPerPage, totalItems)

  return (
    <div className="flex items-center justify-between px-1 py-3">
      <p className="text-sm text-gray-400">
        Mostrando {from}–{to} de {totalItems}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>

        <span className="text-sm text-gray-300 tabular-nums">
          {currentPage} / {totalPages}
        </span>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Página siguiente"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
