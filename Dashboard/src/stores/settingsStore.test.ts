/**
 * settingsStore tests (C-28).
 *
 * TDD — tests written before the store implementation.
 *
 * Covers:
 *  - Initial state: branchSettings null, tenantSettings null
 *  - fetchBranchSettings: successful fetch populates slice
 *  - updateBranchSettings: replaces slice
 *  - error: leaves isLoading=false and sets error
 *  - clearBranchSettings: resets branch slice
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Reset store between tests
beforeEach(async () => {
  vi.resetAllMocks()
  // Reset store to initial state so tests are isolated
  const { useSettingsStore } = await import('./settingsStore')
  useSettingsStore.setState({
    branchSettings: null,
    tenantSettings: null,
    isLoadingBranch: false,
    isLoadingTenant: false,
    error: null,
  })
})

// Mock settingsAPI
vi.mock('@/services/settingsAPI', () => ({
  getBranchSettings: vi.fn(),
  updateBranchSettings: vi.fn(),
  getTenantSettings: vi.fn(),
  updateTenantSettings: vi.fn(),
}))

describe('settingsStore', () => {
  it('has null initial state for branchSettings and tenantSettings', async () => {
    const { useSettingsStore } = await import('./settingsStore')
    const state = useSettingsStore.getState()

    expect(state.branchSettings).toBeNull()
    expect(state.tenantSettings).toBeNull()
    expect(state.isLoadingBranch).toBe(false)
    expect(state.isLoadingTenant).toBe(false)
    expect(state.error).toBeNull()
  })

  it('fetchBranchSettings: populates branchSettings on success', async () => {
    const { getBranchSettings } = await import('@/services/settingsAPI')
    const { useSettingsStore } = await import('./settingsStore')

    const mockBranch = {
      id: '1',
      tenant_id: '10',
      name: 'Test Branch',
      address: 'Addr',
      slug: 'test-branch',
      phone: null,
      timezone: 'America/Argentina/Buenos_Aires',
      opening_hours: null,
    }
    vi.mocked(getBranchSettings).mockResolvedValue(mockBranch)

    await useSettingsStore.getState().fetchBranchSettings('1')

    const state = useSettingsStore.getState()
    expect(state.branchSettings).toEqual(mockBranch)
    expect(state.isLoadingBranch).toBe(false)
    expect(state.error).toBeNull()
  })

  it('fetchBranchSettings: sets error and stops loading on failure', async () => {
    const { getBranchSettings } = await import('@/services/settingsAPI')
    const { useSettingsStore } = await import('./settingsStore')

    vi.mocked(getBranchSettings).mockRejectedValue(new Error('Network error'))

    await useSettingsStore.getState().fetchBranchSettings('1')

    const state = useSettingsStore.getState()
    expect(state.branchSettings).toBeNull()
    expect(state.isLoadingBranch).toBe(false)
    expect(state.error).not.toBeNull()
  })

  it('updateBranchSettings: replaces branchSettings slice', async () => {
    const { updateBranchSettings } = await import('@/services/settingsAPI')
    const { useSettingsStore } = await import('./settingsStore')

    const updatedBranch = {
      id: '1',
      tenant_id: '10',
      name: 'Updated Branch',
      address: 'New Addr',
      slug: 'updated-branch',
      phone: '+54 11 1234',
      timezone: 'Europe/Madrid',
      opening_hours: null,
    }
    vi.mocked(updateBranchSettings).mockResolvedValue(updatedBranch)

    await useSettingsStore.getState().updateBranchSettings('1', { name: 'Updated Branch' })

    const state = useSettingsStore.getState()
    expect(state.branchSettings).toEqual(updatedBranch)
    expect(state.isLoadingBranch).toBe(false)
  })

  it('clearBranchSettings: resets branchSettings to null', async () => {
    const { useSettingsStore } = await import('./settingsStore')

    // Set some state first
    useSettingsStore.setState({ branchSettings: { id: '1' } as unknown as import('@/types/settings').BranchSettings })

    useSettingsStore.getState().clearBranchSettings()

    expect(useSettingsStore.getState().branchSettings).toBeNull()
  })

  it('fetchTenantSettings: populates tenantSettings on success', async () => {
    const { getTenantSettings } = await import('@/services/settingsAPI')
    const { useSettingsStore } = await import('./settingsStore')

    const mockTenant = { id: '10', name: 'My Tenant' }
    vi.mocked(getTenantSettings).mockResolvedValue(mockTenant)

    await useSettingsStore.getState().fetchTenantSettings()

    expect(useSettingsStore.getState().tenantSettings).toEqual(mockTenant)
    expect(useSettingsStore.getState().isLoadingTenant).toBe(false)
  })
})
