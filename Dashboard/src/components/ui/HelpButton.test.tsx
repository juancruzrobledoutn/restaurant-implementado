/**
 * Tests for HelpButton component.
 *
 * Skill: test-driven-development, help-system-content
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelpButton } from './HelpButton'

describe('HelpButton', () => {
  it('renders a button with accessible label', () => {
    render(<HelpButton title="Categories" content={<p>Help content</p>} />)
    expect(screen.getByRole('button', { name: 'Ayuda: Categories' })).toBeInTheDocument()
  })

  it('panel is hidden by default', () => {
    render(<HelpButton title="Categories" content={<p>Help content</p>} />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('opens panel on click', async () => {
    render(<HelpButton title="Help Title" content={<p>This is help</p>} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ayuda: Help Title' }))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    expect(screen.getByText('This is help')).toBeInTheDocument()
  })

  it('closes panel on second click (toggle)', async () => {
    render(<HelpButton title="Help Title" content={<p>Content</p>} />)
    const button = screen.getByRole('button', { name: 'Ayuda: Help Title' })
    await userEvent.click(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await userEvent.click(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders title in the panel', async () => {
    render(<HelpButton title="My Title" content={<p>My content</p>} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ayuda: My Title' }))
    expect(screen.getByText('My Title')).toBeInTheDocument()
  })
})
