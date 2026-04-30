/**
 * useAuthPermissions tests — C-27 extensions.
 *
 * Covers: ADMIN full perms, MANAGER promo perms (no delete), KITCHEN/WAITER forbidden.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAuthPermissions } from './useAuthPermissions'

// ---------------------------------------------------------------------------
// Mock authStore
// ---------------------------------------------------------------------------

let mockRoles: string[] = []

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { roles: mockRoles } }),
  selectUser: (s: { user: unknown }) => s.user,
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockRoles = []
})

describe('useAuthPermissions — ADMIN', () => {
  it('returns full permissions for ADMIN', () => {
    mockRoles = ['ADMIN']
    const { result } = renderHook(() => useAuthPermissions())
    expect(result.current.isAdmin).toBe(true)
    expect(result.current.isManager).toBe(false)
    expect(result.current.canCreate).toBe(true)
    expect(result.current.canEdit).toBe(true)
    expect(result.current.canDelete).toBe(true)
    expect(result.current.canManagePromotions).toBe(true)
    expect(result.current.canDeletePromotion).toBe(true)
  })
})

describe('useAuthPermissions — MANAGER', () => {
  it('returns manage-promo=true but delete-promo=false for MANAGER', () => {
    mockRoles = ['MANAGER']
    const { result } = renderHook(() => useAuthPermissions())
    expect(result.current.isAdmin).toBe(false)
    expect(result.current.isManager).toBe(true)
    expect(result.current.canCreate).toBe(true)
    expect(result.current.canEdit).toBe(true)
    expect(result.current.canDelete).toBe(false)
    expect(result.current.canManagePromotions).toBe(true)
    expect(result.current.canDeletePromotion).toBe(false)
  })
})

describe('useAuthPermissions — KITCHEN', () => {
  it('returns false for canManagePromotions and canDeletePromotion', () => {
    mockRoles = ['KITCHEN']
    const { result } = renderHook(() => useAuthPermissions())
    expect(result.current.canManagePromotions).toBe(false)
    expect(result.current.canDeletePromotion).toBe(false)
  })
})

describe('useAuthPermissions — WAITER', () => {
  it('returns false for canManagePromotions and canDeletePromotion', () => {
    mockRoles = ['WAITER']
    const { result } = renderHook(() => useAuthPermissions())
    expect(result.current.canManagePromotions).toBe(false)
    expect(result.current.canDeletePromotion).toBe(false)
  })
})
