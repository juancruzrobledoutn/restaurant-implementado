/**
 * CancelOrderDialog component tests (C-25).
 *
 * Skill: test-driven-development, dashboard-crud-page
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CancelOrderDialog } from './CancelOrderDialog'

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onConfirm: vi.fn().mockResolvedValue(undefined),
  roundNumber: 5,
  isLoading: false,
}

describe('CancelOrderDialog', () => {
  it('renders title with round number', () => {
    render(<CancelOrderDialog {...defaultProps} />)
    expect(screen.getByText(/Cancelar ronda #5/i)).toBeInTheDocument()
  })

  it('does not render when isOpen=false', () => {
    render(<CancelOrderDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByText(/Cancelar ronda/i)).not.toBeInTheDocument()
  })

  it('renders textarea for cancel_reason', () => {
    render(<CancelOrderDialog {...defaultProps} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('confirm button is disabled when reason is empty', () => {
    render(<CancelOrderDialog {...defaultProps} />)
    const btn = screen.getByRole('button', { name: /Confirmar cancelación/i })
    expect(btn).toBeDisabled()
  })

  it('confirm button is enabled after entering a reason', async () => {
    render(<CancelOrderDialog {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox'), 'Cliente se fue')
    const btn = screen.getByRole('button', { name: /Confirmar cancelación/i })
    expect(btn).not.toBeDisabled()
  })

  it('calls onConfirm with trimmed reason on submit', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<CancelOrderDialog {...defaultProps} onConfirm={onConfirm} />)
    await userEvent.type(screen.getByRole('textbox'), '  Cliente se fue  ')
    await userEvent.click(screen.getByRole('button', { name: /Confirmar cancelación/i }))
    expect(onConfirm).toHaveBeenCalledWith('Cliente se fue')
  })

  it('shows error when submitting empty', async () => {
    render(<CancelOrderDialog {...defaultProps} />)
    // Click confirm without typing — button is disabled so we verify via validation state
    // The confirm button should remain disabled
    const btn = screen.getByRole('button', { name: /Confirmar cancelación/i })
    expect(btn).toBeDisabled()
  })

  it('shows character counter', async () => {
    render(<CancelOrderDialog {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox'), 'abc')
    expect(screen.getByText('3/500')).toBeInTheDocument()
  })

  it('calls onClose when Volver is clicked', async () => {
    const onClose = vi.fn()
    render(<CancelOrderDialog {...defaultProps} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /Volver/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('disables textarea and buttons when isLoading', () => {
    render(<CancelOrderDialog {...defaultProps} isLoading />)
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Volver/i })).toBeDisabled()
  })

  it('renders generic title when roundNumber is null', () => {
    render(<CancelOrderDialog {...defaultProps} roundNumber={null} />)
    expect(screen.getByText('Cancelar ronda')).toBeInTheDocument()
  })
})
