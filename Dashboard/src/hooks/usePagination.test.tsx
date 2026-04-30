/**
 * Tests for usePagination hook.
 *
 * Skill: test-driven-development, dashboard-crud-page
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePagination } from './usePagination'

function makeItems(count: number): { id: string; name: string }[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i + 1), name: `Item ${i + 1}` }))
}

describe('usePagination', () => {
  it('returns totalPages=13 for 125 items with itemsPerPage=10', () => {
    const items = makeItems(125)
    const { result } = renderHook(() => usePagination(items, 10))

    expect(result.current.totalPages).toBe(13)
    expect(result.current.totalItems).toBe(125)
    expect(result.current.itemsPerPage).toBe(10)
    expect(result.current.currentPage).toBe(1)
  })

  it('returns first 10 items on page 1', () => {
    const items = makeItems(125)
    const { result } = renderHook(() => usePagination(items, 10))

    expect(result.current.paginatedItems).toHaveLength(10)
    expect(result.current.paginatedItems[0]!.id).toBe('1')
    expect(result.current.paginatedItems[9]!.id).toBe('10')
  })

  it('setCurrentPage(3) returns items 21–30 and sets currentPage=3', () => {
    const items = makeItems(125)
    const { result } = renderHook(() => usePagination(items, 10))

    act(() => {
      result.current.setCurrentPage(3)
    })

    expect(result.current.currentPage).toBe(3)
    expect(result.current.paginatedItems).toHaveLength(10)
    expect(result.current.paginatedItems[0]!.id).toBe('21')
    expect(result.current.paginatedItems[9]!.id).toBe('30')
  })

  it('last page returns remaining items (125 mod 10 = 5)', () => {
    const items = makeItems(125)
    const { result } = renderHook(() => usePagination(items, 10))

    act(() => {
      result.current.setCurrentPage(13)
    })

    expect(result.current.paginatedItems).toHaveLength(5)
    expect(result.current.paginatedItems[0]!.id).toBe('121')
  })

  it('clamps page to totalPages when items shrink', () => {
    let items = makeItems(125)
    const { result, rerender } = renderHook((i: { id: string; name: string }[]) => usePagination(i, 10), {
      initialProps: items,
    })

    act(() => {
      result.current.setCurrentPage(13)
    })
    expect(result.current.currentPage).toBe(13)

    // Reduce items to 20 — only 2 pages
    items = makeItems(20)
    rerender(items)

    expect(result.current.currentPage).toBe(2)
    expect(result.current.totalPages).toBe(2)
  })

  it('returns totalPages=1 for empty array', () => {
    const { result } = renderHook(() => usePagination([], 10))

    expect(result.current.totalPages).toBe(1)
    expect(result.current.totalItems).toBe(0)
    expect(result.current.paginatedItems).toHaveLength(0)
  })

  it('clamps setCurrentPage to valid range', () => {
    const items = makeItems(30)
    const { result } = renderHook(() => usePagination(items, 10))

    act(() => {
      result.current.setCurrentPage(999)
    })
    expect(result.current.currentPage).toBe(3)

    act(() => {
      result.current.setCurrentPage(-5)
    })
    expect(result.current.currentPage).toBe(1)
  })

  it('uses default itemsPerPage=10', () => {
    const items = makeItems(25)
    const { result } = renderHook(() => usePagination(items))

    expect(result.current.itemsPerPage).toBe(10)
    expect(result.current.totalPages).toBe(3)
  })
})
