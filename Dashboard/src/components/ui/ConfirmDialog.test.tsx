/**
 * Tests for ConfirmDialog component.
 *
 * Skill: test-driven-development, dashboard-crud-page
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders with title and message when open', () => {
    render(
      <ConfirmDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Eliminar Elemento"
        message='¿Estás seguro de eliminar "Bebidas"?'
      />
    )
    expect(screen.getByText('Eliminar Elemento')).toBeInTheDocument()
    expect(screen.getByText('¿Estás seguro de eliminar "Bebidas"?')).toBeInTheDocument()
  })

  it('does not render when isOpen=false', () => {
    render(
      <ConfirmDialog
        isOpen={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Test"
        message="Test message"
      />
    )
    expect(screen.queryByText('Test')).not.toBeInTheDocument()
  })

  it('calls onConfirm when confirm button is clicked', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={onConfirm}
        title="Delete"
        message="Are you sure?"
        confirmLabel="Confirmar"
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when cancel button is clicked', async () => {
    const onClose = vi.fn()
    render(
      <ConfirmDialog
        isOpen
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Delete"
        message="Are you sure?"
        cancelLabel="Cancelar"
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders children (cascade preview)', () => {
    render(
      <ConfirmDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete"
        message="Are you sure?"
      >
        <div data-testid="cascade-preview">3 subcategories will be deleted</div>
      </ConfirmDialog>
    )
    expect(screen.getByTestId('cascade-preview')).toBeInTheDocument()
  })
})
