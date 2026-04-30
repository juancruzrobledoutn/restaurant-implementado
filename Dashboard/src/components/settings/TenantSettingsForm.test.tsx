/**
 * Tests for TenantSettingsForm (C-28, task 13.4).
 *
 * Coverage:
 * - Name blank rejected (shows error)
 * - Happy path calls updateTenantSettings
 *
 * Skill: test-driven-development, react19-form-pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TenantSettings } from '@/types/settings'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTenantSettings: TenantSettings = { id: '10', name: 'Mi Negocio' }
const mockUpdateTenantSettings = vi.fn()
const mockFetchTenantSettings = vi.fn()

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ tenantSettings: mockTenantSettings }),
  selectTenantSettings: (s: { tenantSettings: TenantSettings | null }) => s.tenantSettings,
  useSettingsActions: () => ({
    fetchTenantSettings: mockFetchTenantSettings,
    updateTenantSettings: mockUpdateTenantSettings,
    fetchBranchSettings: vi.fn(),
    updateBranchSettings: vi.fn(),
    clearBranchSettings: vi.fn(),
  }),
}))

vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { TenantSettingsForm } from './TenantSettingsForm'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TenantSettingsForm', () => {
  it('renders with pre-filled tenant name', () => {
    render(<TenantSettingsForm />)
    expect(screen.getByDisplayValue('Mi Negocio')).toBeInTheDocument()
  })

  it('shows error when name is blank', async () => {
    const user = userEvent.setup()
    const { container } = render(<TenantSettingsForm />)

    const nameInput = screen.getByDisplayValue('Mi Negocio')
    await user.clear(nameInput)

    const form = container.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText(/nombre del negocio es requerido/i)).toBeInTheDocument()
    })
  })

  it('calls updateTenantSettings on happy path', async () => {
    mockUpdateTenantSettings.mockResolvedValue({ id: '10', name: 'Nuevo Nombre' })
    const user = userEvent.setup()
    const { container } = render(<TenantSettingsForm />)

    const nameInput = screen.getByDisplayValue('Mi Negocio')
    await user.clear(nameInput)
    await user.type(nameInput, 'Nuevo Nombre')

    const form = container.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockUpdateTenantSettings).toHaveBeenCalledWith({ name: 'Nuevo Nombre' })
    })
  })
})
