/**
 * Tests for Badge component — accessibility sr-only presence.
 *
 * Skill: test-driven-development, dashboard-crud-page
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Activo</Badge>)
    expect(screen.getByText('Activo')).toBeInTheDocument()
  })

  it('contains sr-only "Estado:" for screen readers', () => {
    const { container } = render(<Badge>Activo</Badge>)
    const srOnly = container.querySelector('.sr-only')
    expect(srOnly).toBeInTheDocument()
    expect(srOnly?.textContent).toBe('Estado:')
  })

  it('applies success variant styles', () => {
    const { container } = render(<Badge variant="success">Activo</Badge>)
    expect(container.firstChild).toHaveClass('text-green-400')
  })

  it('applies danger variant styles', () => {
    const { container } = render(<Badge variant="danger">Inactivo</Badge>)
    expect(container.firstChild).toHaveClass('text-red-400')
  })

  it('applies neutral variant by default', () => {
    const { container } = render(<Badge>Neutral</Badge>)
    expect(container.firstChild).toHaveClass('text-gray-400')
  })
})
