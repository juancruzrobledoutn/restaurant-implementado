/**
 * Tests for SlugChangeDialog (C-28, task 13.6).
 *
 * Coverage:
 * - Confirm button blocked until re-type exactly matches newSlug
 * - Cancel closes without triggering onConfirm
 * - Escape closes dialog (calls onCancel)
 * - Shows old URL and new URL
 *
 * Skill: test-driven-development
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SlugChangeDialog } from './SlugChangeDialog'

const DEFAULT_PROPS = {
  isOpen: true,
  oldSlug: 'my-branch',
  newSlug: 'new-branch',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

describe('SlugChangeDialog', () => {
  it('renders as alertdialog when open', () => {
    render(<SlugChangeDialog {...DEFAULT_PROPS} />)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('does not render when isOpen=false', () => {
    render(<SlugChangeDialog {...DEFAULT_PROPS} isOpen={false} />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows old slug and new slug in URL preview', () => {
    render(<SlugChangeDialog {...DEFAULT_PROPS} />)
    expect(screen.getByText(/my-branch/)).toBeInTheDocument()
    // new slug appears both in URL preview and in the instruction text
    const newSlugElements = screen.getAllByText(/new-branch/)
    expect(newSlugElements.length).toBeGreaterThan(0)
  })

  it('Confirm button is disabled initially (no text typed)', () => {
    render(<SlugChangeDialog {...DEFAULT_PROPS} />)
    const confirmBtn = screen.getByRole('button', { name: /confirmar cambio/i })
    expect(confirmBtn).toBeDisabled()
  })

  it('Confirm button stays disabled if typed text does not match', async () => {
    const user = userEvent.setup()
    render(<SlugChangeDialog {...DEFAULT_PROPS} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'wrong-slug')

    const confirmBtn = screen.getByRole('button', { name: /confirmar cambio/i })
    expect(confirmBtn).toBeDisabled()
  })

  it('Confirm button enables when typed text matches newSlug exactly', async () => {
    const user = userEvent.setup()
    render(<SlugChangeDialog {...DEFAULT_PROPS} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'new-branch')

    const confirmBtn = screen.getByRole('button', { name: /confirmar cambio/i })
    expect(confirmBtn).not.toBeDisabled()
  })

  it('calls onConfirm when Confirm button clicked with correct re-type', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<SlugChangeDialog {...DEFAULT_PROPS} onConfirm={onConfirm} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'new-branch')

    const confirmBtn = screen.getByRole('button', { name: /confirmar cambio/i })
    await user.click(confirmBtn)

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when Cancel button is clicked', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(<SlugChangeDialog {...DEFAULT_PROPS} onCancel={onCancel} />)

    const cancelBtn = screen.getByRole('button', { name: /cancelar/i })
    await user.click(cancelBtn)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn()
    render(<SlugChangeDialog {...DEFAULT_PROPS} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('resets typed text when dialog opens', async () => {
    const { rerender } = render(<SlugChangeDialog {...DEFAULT_PROPS} isOpen={false} />)

    // Open the dialog
    rerender(<SlugChangeDialog {...DEFAULT_PROPS} isOpen />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')
  })
})
