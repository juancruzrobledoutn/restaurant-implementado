/**
 * Tests for TwoFactorSection (C-28, task 13.3).
 *
 * Coverage:
 * - Initial state: shows "Activar 2FA" button (disabled state)
 * - Flow: disabled → setup-pending: shows QR code area after setup
 * - Flow: setup-pending → enabled after verify
 * - Cancel in setup returns to disabled state
 * - Disable flow with invalid TOTP shows error (does not change state)
 *
 * Skill: test-driven-development
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---------------------------------------------------------------------------
// Mocks — factories must NOT reference top-level variables (hoisting)
// ---------------------------------------------------------------------------

vi.mock('@/services/authAPI', () => ({
  setup2FA: vi.fn(),
  verify2FA: vi.fn(),
  disable2FA: vi.fn(),
  changePassword: vi.fn(),
}))

vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { totpEnabled: false }, setTotpEnabled: vi.fn() }),
  selectUser: (s: { user: unknown }) => s.user,
  selectSetTotpEnabled: (s: { setTotpEnabled: unknown }) => s.setTotpEnabled,
}))

// ---------------------------------------------------------------------------
// Component under test (import AFTER mocks)
// ---------------------------------------------------------------------------

import { TwoFactorSection } from './TwoFactorSection'
import { setup2FA as mockSetup2FA, verify2FA as mockVerify2FA, disable2FA as _mockDisable2FA } from '@/services/authAPI'

const MOCK_SETUP_DATA = {
  secret: 'JBSWY3DPEHPK3PXP',
  provisioning_uri: 'otpauth://totp/Integrador:user@test.com?secret=JBSWY3DPEHPK3PXP',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TwoFactorSection', () => {
  it('renders disabled state initially with "Activar 2FA" button', () => {
    render(<TwoFactorSection />)
    expect(screen.getByRole('button', { name: /activar 2fa/i })).toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
  })

  it('calls setup2FA and shows QR code area on "Activar 2FA" click', async () => {
    vi.mocked(mockSetup2FA).mockResolvedValue(MOCK_SETUP_DATA)
    const user = userEvent.setup()
    render(<TwoFactorSection />)

    await user.click(screen.getByRole('button', { name: /activar 2fa/i }))

    await waitFor(() => {
      expect(screen.getByAltText(/código qr/i)).toBeInTheDocument()
    })
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
  })

  it('transitions to enabled after successful verify', async () => {
    vi.mocked(mockSetup2FA).mockResolvedValue(MOCK_SETUP_DATA)
    vi.mocked(mockVerify2FA).mockResolvedValue({ detail: 'ok' })
    const user = userEvent.setup()
    render(<TwoFactorSection />)

    // Enter setup
    await user.click(screen.getByRole('button', { name: /activar 2fa/i }))
    await waitFor(() => screen.getByAltText(/código qr/i))

    // Type TOTP code
    const codeInput = screen.getByLabelText(/código de verificación/i)
    await user.type(codeInput, '123456')

    // Verify
    await user.click(screen.getByRole('button', { name: /verificar y activar/i }))

    await waitFor(() => {
      expect(screen.getByText('Activo')).toBeInTheDocument()
    })
  })

  it('cancelling setup returns to disabled state', async () => {
    vi.mocked(mockSetup2FA).mockResolvedValue(MOCK_SETUP_DATA)
    const user = userEvent.setup()
    render(<TwoFactorSection />)

    await user.click(screen.getByRole('button', { name: /activar 2fa/i }))
    await waitFor(() => screen.getByAltText(/código qr/i))

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /activar 2fa/i })).toBeInTheDocument()
    })
    expect(screen.queryByAltText(/código qr/i)).not.toBeInTheDocument()
  })

  it('shows error when verify fails (invalid TOTP)', async () => {
    vi.mocked(mockSetup2FA).mockResolvedValue(MOCK_SETUP_DATA)
    vi.mocked(mockVerify2FA).mockRejectedValue(new Error('400 Invalid TOTP code'))
    const user = userEvent.setup()
    render(<TwoFactorSection />)

    await user.click(screen.getByRole('button', { name: /activar 2fa/i }))
    await waitFor(() => screen.getByAltText(/código qr/i))

    const codeInput = screen.getByLabelText(/código de verificación/i)
    await user.type(codeInput, '000000')
    await user.click(screen.getByRole('button', { name: /verificar y activar/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    // Still in setup-pending — should not have transitioned to enabled
    expect(screen.queryByText('Activo')).not.toBeInTheDocument()
  })
})
