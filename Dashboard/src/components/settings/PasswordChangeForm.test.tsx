/**
 * Tests for PasswordChangeForm (C-28, task 13.2).
 *
 * Coverage:
 * - Policy validation: too short, no uppercase, no digit
 * - Confirm mismatch shows error
 * - 400 (wrong current password) shows error on currentPassword field
 * - Happy path calls changePassword
 *
 * Skill: test-driven-development, react19-form-pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---------------------------------------------------------------------------
// Mocks — factories must NOT reference top-level variables (hoisting)
// ---------------------------------------------------------------------------

vi.mock('@/services/authAPI', () => ({
  changePassword: vi.fn(),
  setup2FA: vi.fn(),
  verify2FA: vi.fn(),
  disable2FA: vi.fn(),
}))

vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Component under test (import AFTER mocks)
// ---------------------------------------------------------------------------

import { PasswordChangeForm } from './PasswordChangeForm'
import { changePassword as mockChangePassword } from '@/services/authAPI'

beforeEach(() => {
  vi.clearAllMocks()
})

function getFields(container: HTMLElement) {
  return {
    currentPasswordInput: container.querySelector('input[name="currentPassword"]') as HTMLInputElement,
    newPasswordInput: container.querySelector('input[name="newPassword"]') as HTMLInputElement,
    confirmPasswordInput: container.querySelector('input[name="confirmPassword"]') as HTMLInputElement,
  }
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  {
    currentPassword = 'OldPassword1',
    newPassword = 'NewPassword1',
    confirmPassword,
  }: {
    currentPassword?: string
    newPassword?: string
    confirmPassword?: string
  } = {},
) {
  const confirm = confirmPassword ?? newPassword
  const { currentPasswordInput, newPasswordInput, confirmPasswordInput } = getFields(container)
  await user.type(currentPasswordInput, currentPassword)
  await user.type(newPasswordInput, newPassword)
  await user.type(confirmPasswordInput, confirm)
}

describe('PasswordChangeForm', () => {
  it('renders the three password fields', () => {
    const { container } = render(<PasswordChangeForm />)
    expect(container.querySelector('input[name="currentPassword"]')).toBeInTheDocument()
    expect(container.querySelector('input[name="newPassword"]')).toBeInTheDocument()
    expect(container.querySelector('input[name="confirmPassword"]')).toBeInTheDocument()
  })

  it('shows error when new password is too short', async () => {
    const user = userEvent.setup()
    const { container } = render(<PasswordChangeForm />)
    await fillForm(user, container, { newPassword: 'Short1', confirmPassword: 'Short1' })
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    await waitFor(() => {
      expect(screen.getByText(/al menos 8 caracteres/i)).toBeInTheDocument()
    })
  })

  it('shows error when new password has no uppercase', async () => {
    const user = userEvent.setup()
    const { container } = render(<PasswordChangeForm />)
    await fillForm(user, container, { newPassword: 'nouppercase1', confirmPassword: 'nouppercase1' })
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    await waitFor(() => {
      // Use role=alert to target the error (not the policy hint list)
      const alerts = screen.getAllByRole('alert')
      expect(alerts.some((a) => /mayúscula/i.test(a.textContent ?? ''))).toBe(true)
    })
  })

  it('shows error when new password has no digit', async () => {
    const user = userEvent.setup()
    const { container } = render(<PasswordChangeForm />)
    await fillForm(user, container, { newPassword: 'NoDigitHere', confirmPassword: 'NoDigitHere' })
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      expect(alerts.some((a) => /número/i.test(a.textContent ?? ''))).toBe(true)
    })
  })

  it('shows error when passwords do not match', async () => {
    const user = userEvent.setup()
    const { container } = render(<PasswordChangeForm />)
    await fillForm(user, container, { confirmPassword: 'DifferentPass1' })
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    await waitFor(() => {
      expect(screen.getByText(/no coinciden/i)).toBeInTheDocument()
    })
  })

  it('shows error on currentPassword field when backend returns 400', async () => {
    vi.mocked(mockChangePassword).mockRejectedValue(new Error('400 Incorrect current password'))
    const user = userEvent.setup()
    const { container } = render(<PasswordChangeForm />)
    await fillForm(user, container)
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    await waitFor(() => {
      expect(screen.getByText(/contraseña actual incorrecta/i)).toBeInTheDocument()
    })
  })

  it('calls changePassword with correct args on happy path', async () => {
    vi.mocked(mockChangePassword).mockResolvedValue({ detail: 'ok' })
    const user = userEvent.setup()
    const { container } = render(<PasswordChangeForm />)
    await fillForm(user, container, { currentPassword: 'OldPass1', newPassword: 'NewPass1' })
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith({
        currentPassword: 'OldPass1',
        newPassword: 'NewPass1',
      })
    })
  })
})
