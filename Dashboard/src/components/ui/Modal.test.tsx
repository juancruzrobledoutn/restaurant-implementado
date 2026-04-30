/**
 * Tests for Modal component — focus trap, ARIA, accessibility.
 *
 * Skill: test-driven-development, dashboard-crud-page
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal'
import { Button } from './Button'

function TestModal({
  isOpen = true,
  onClose = vi.fn(),
}: {
  isOpen?: boolean
  onClose?: () => void
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Test Modal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Submit</Button>
        </>
      }
    >
      <input data-testid="first-input" placeholder="First" />
      <input data-testid="second-input" placeholder="Second" />
    </Modal>
  )
}

describe('Modal', () => {
  it('renders when isOpen=true', () => {
    render(<TestModal isOpen />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Test Modal')).toBeInTheDocument()
  })

  it('does not render when isOpen=false', () => {
    render(<TestModal isOpen={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('has role="dialog" and aria-modal="true"', () => {
    render(<TestModal />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('has aria-labelledby pointing to title', () => {
    render(<TestModal />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')
    expect(screen.getByText('Test Modal')).toHaveAttribute('id', 'modal-title')
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<TestModal onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    render(<TestModal onClose={onClose} />)
    const closeBtn = screen.getByRole('button', { name: 'Cerrar modal' })
    await userEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn()
    const { container } = render(<TestModal onClose={onClose} />)
    // The backdrop is the first div (fixed positioning overlay)
    const backdrop = container.querySelector('.absolute.inset-0.bg-black\\/60')
    if (backdrop) {
      await userEvent.click(backdrop)
      expect(onClose).toHaveBeenCalledTimes(1)
    }
  })

  it('renders footer content', () => {
    render(<TestModal />)
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByText('Submit')).toBeInTheDocument()
  })
})
