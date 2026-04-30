/**
 * usePagination — canonical hook for client-side pagination in CRUD pages.
 *
 * Replaces raw useState for pagination state.
 * NEVER use useState directly in a CRUD page for this role.
 *
 * Skill: dashboard-crud-page
 */

import { useState, useMemo } from 'react'

export interface UsePaginationReturn<T> {
  paginatedItems: T[]
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  setCurrentPage: (page: number) => void
}

/**
 * Client-side pagination over a sorted array.
 *
 * @param items - The full sorted array to paginate
 * @param itemsPerPage - Number of items per page (default: 10)
 */
export function usePagination<T>(items: readonly T[], itemsPerPage = 10): UsePaginationReturn<T> {
  const [currentPage, setCurrentPageRaw] = useState(1)

  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))

  // Clamp current page when items change (e.g. after delete)
  const clampedPage = Math.min(currentPage, totalPages)

  const paginatedItems = useMemo(() => {
    const start = (clampedPage - 1) * itemsPerPage
    const end = start + itemsPerPage
    return items.slice(start, end) as T[]
  }, [items, clampedPage, itemsPerPage])

  function setCurrentPage(page: number): void {
    const clamped = Math.max(1, Math.min(page, totalPages))
    setCurrentPageRaw(clamped)
  }

  return {
    paginatedItems,
    currentPage: clampedPage,
    totalPages,
    totalItems,
    itemsPerPage,
    setCurrentPage,
  }
}
