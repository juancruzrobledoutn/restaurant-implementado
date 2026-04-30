/**
 * Tests for BranchSettingsForm (C-28, task 13.1).
 *
 * Coverage:
 * - Slug regex error shown for invalid slug
 * - SlugChangeDialog opens when slug changes
 * - Submit happy path calls updateBranchSettings
 * - 409 (duplicate slug) shows inline error on slug field
 *
 * Skill: test-driven-development, react19-form-pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BranchSettings } from '@/types/settings'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockBranchSettings: BranchSettings = {
  id: '1',
  tenant_id: '10',
  name: 'Sucursal Centro',
  address: 'Av. Corrientes 1234',
  slug: 'sucursal-centro',
  phone: null,
  timezone: 'America/Argentina/Buenos_Aires',
  opening_hours: null,
}

const mockUpdateBranchSettings = vi.fn()
const mockFetchBranchSettings = vi.fn()

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ branchSettings: mockBranchSettings }),
  selectBranchSettings: (s: { branchSettings: BranchSettings | null }) => s.branchSettings,
  useSettingsActions: () => ({
    fetchBranchSettings: mockFetchBranchSettings,
    updateBranchSettings: mockUpdateBranchSettings,
  }),
}))

vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { BranchSettingsForm } from './BranchSettingsForm'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BranchSettingsForm', () => {
  it('renders with pre-filled values from store', () => {
    render(<BranchSettingsForm branchId="1" />)
    expect(screen.getByDisplayValue('Sucursal Centro')).toBeInTheDocument()
    expect(screen.getByDisplayValue('sucursal-centro')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Av. Corrientes 1234')).toBeInTheDocument()
  })

  it('shows slug regex error for invalid slug', async () => {
    const user = userEvent.setup()
    render(<BranchSettingsForm branchId="1" />)

    const slugInput = screen.getByDisplayValue('sucursal-centro')
    await user.clear(slugInput)
    await user.type(slugInput, 'INVALID SLUG!')

    const submitBtn = screen.getByRole('button', { name: /guardar configuración/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText(/solo minúsculas/i)).toBeInTheDocument()
    })
  })

  it('opens SlugChangeDialog when slug value changes on submit', async () => {
    const user = userEvent.setup()
    render(<BranchSettingsForm branchId="1" />)

    const slugInput = screen.getByDisplayValue('sucursal-centro')
    await user.clear(slugInput)
    await user.type(slugInput, 'nuevo-slug')

    const submitBtn = screen.getByRole('button', { name: /guardar configuración/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })

  it('calls updateBranchSettings on submit when slug unchanged', async () => {
    mockUpdateBranchSettings.mockResolvedValue(mockBranchSettings)
    const user = userEvent.setup()
    render(<BranchSettingsForm branchId="1" />)

    const submitBtn = screen.getByRole('button', { name: /guardar configuración/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(mockUpdateBranchSettings).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ name: 'Sucursal Centro', slug: 'sucursal-centro' }),
      )
    })
  })

  it('shows inline slug error on 409 conflict', async () => {
    mockUpdateBranchSettings.mockRejectedValue(new Error('409 Conflict: slug already in use'))
    const user = userEvent.setup()
    render(<BranchSettingsForm branchId="1" />)

    const submitBtn = screen.getByRole('button', { name: /guardar configuración/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText(/este slug ya está en uso/i)).toBeInTheDocument()
    })
  })
})
