/**
 * Tests for useFormModal hook.
 *
 * Skill: test-driven-development, dashboard-crud-page
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFormModal } from './useFormModal'

interface TestFormData {
  name: string
  order: number
  is_active: boolean
}

interface TestEntity {
  id: string
  name: string
  order: number
  is_active: boolean
}

const initialFormData: TestFormData = {
  name: '',
  order: 0,
  is_active: true,
}

describe('useFormModal', () => {
  it('starts with isOpen=false and no selectedItem', () => {
    const { result } = renderHook(() => useFormModal<TestFormData, TestEntity>(initialFormData))

    expect(result.current.isOpen).toBe(false)
    expect(result.current.selectedItem).toBeNull()
    expect(result.current.formData).toEqual(initialFormData)
  })

  it('openCreate sets isOpen=true, selectedItem=null, uses default formData', () => {
    const { result } = renderHook(() => useFormModal<TestFormData, TestEntity>(initialFormData))

    act(() => {
      result.current.openCreate()
    })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.selectedItem).toBeNull()
    expect(result.current.formData).toEqual(initialFormData)
  })

  it('openCreate with partial initial merges with defaults', () => {
    const { result } = renderHook(() => useFormModal<TestFormData, TestEntity>(initialFormData))

    act(() => {
      result.current.openCreate({ name: 'Preloaded' })
    })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.formData.name).toBe('Preloaded')
    expect(result.current.formData.order).toBe(0)
  })

  it('openEdit sets isOpen=true, selectedItem, and applies mapper', () => {
    const { result } = renderHook(() => useFormModal<TestFormData, TestEntity>(initialFormData))

    const entity: TestEntity = { id: '1', name: 'Bebidas', order: 5, is_active: false }
    const mapper = (e: TestEntity): TestFormData => ({
      name: e.name,
      order: e.order,
      is_active: e.is_active,
    })

    act(() => {
      result.current.openEdit(entity, mapper)
    })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.selectedItem).toEqual(entity)
    expect(result.current.formData).toEqual({ name: 'Bebidas', order: 5, is_active: false })
  })

  it('close sets isOpen=false', () => {
    const { result } = renderHook(() => useFormModal<TestFormData, TestEntity>(initialFormData))

    act(() => {
      result.current.openCreate()
    })
    expect(result.current.isOpen).toBe(true)

    act(() => {
      result.current.close()
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('setFormData updates formData', () => {
    const { result } = renderHook(() => useFormModal<TestFormData, TestEntity>(initialFormData))

    act(() => {
      result.current.openCreate()
    })

    act(() => {
      result.current.setFormData((prev) => ({ ...prev, name: 'Updated' }))
    })

    expect(result.current.formData.name).toBe('Updated')
  })
})
