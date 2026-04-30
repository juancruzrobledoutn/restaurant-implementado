/**
 * HomeEmptyBranchState unit tests (C-30).
 *
 * Skills: test-driven-development, vercel-react-best-practices
 *
 * Covers:
 * - Renders title and CTA button
 * - Click on CTA dispatches CustomEvent('dashboard:focus-branch-switcher')
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HomeEmptyBranchState } from './HomeEmptyBranchState'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HomeEmptyBranchState', () => {
  it('renders the title and description', () => {
    render(<HomeEmptyBranchState />)
    // Use getAllByText because "sucursal" appears in both h2 and the description paragraph
    expect(screen.getByRole('heading', { name: /Selecciona una sucursal/i })).toBeInTheDocument()
    expect(screen.getByText(/resumen operativo/i)).toBeInTheDocument()
  })

  it('renders the "Elegir sucursal" CTA button', () => {
    render(<HomeEmptyBranchState />)
    expect(screen.getByRole('button', { name: /Elegir sucursal/i })).toBeInTheDocument()
  })

  it('dispatches CustomEvent("dashboard:focus-branch-switcher") on CTA click', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    render(<HomeEmptyBranchState />)

    const ctaButton = screen.getByRole('button', { name: /Elegir sucursal/i })
    fireEvent.click(ctaButton)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dashboard:focus-branch-switcher' }),
    )
  })

  it('does not throw when window is defined', () => {
    // Verifies the typeof window guard doesn't break in a normal browser environment
    render(<HomeEmptyBranchState />)
    const ctaButton = screen.getByRole('button', { name: /Elegir sucursal/i })
    expect(() => fireEvent.click(ctaButton)).not.toThrow()
  })
})
