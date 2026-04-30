/**
 * Tests for useConfirmDialog hook.
 *
 * Skill: test-driven-development, dashboard-crud-page
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useConfirmDialog } from './useConfirmDialog'

interface TestEntity {
  id: string
  name: string
}

describe('useConfirmDialog', () => {
  it('starts with isOpen=false and no item', () => {
    const { result } = renderHook(() => useConfirmDialog<TestEntity>())

    expect(result.current.isOpen).toBe(false)
    expect(result.current.item).toBeNull()
  })

  it('open sets isOpen=true and stores the item', () => {
    const { result } = renderHook(() => useConfirmDialog<TestEntity>())

    const entity: TestEntity = { id: '1', name: 'Test' }
    act(() => {
      result.current.open(entity)
    })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.item).toEqual(entity)
  })

  it('close sets isOpen=false', () => {
    const { result } = renderHook(() => useConfirmDialog<TestEntity>())

    act(() => {
      result.current.open({ id: '1', name: 'Test' })
    })
    expect(result.current.isOpen).toBe(true)

    act(() => {
      result.current.close()
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('item is still accessible immediately after close (before timeout)', () => {
    const { result } = renderHook(() => useConfirmDialog<TestEntity>())

    const entity: TestEntity = { id: '42', name: 'Target' }
    act(() => {
      result.current.open(entity)
    })
    act(() => {
      result.current.close()
    })

    // Item remains set immediately after close (timeout hasn't fired)
    // This is intentional: allows rendering during close animation
    expect(result.current.item).toEqual(entity)
  })

  it('preserves item reference while open', () => {
    const { result } = renderHook(() => useConfirmDialog<TestEntity>())

    const entity: TestEntity = { id: '99', name: 'Persistent' }
    act(() => {
      result.current.open(entity)
    })

    expect(result.current.item).toBe(entity)
  })
})
