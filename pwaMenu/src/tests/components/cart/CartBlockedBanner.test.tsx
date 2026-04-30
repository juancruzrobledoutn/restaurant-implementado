/**
 * Tests for CartBlockedBanner component.
 * Tests: renders banner when PAYING, visible t() text.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CartBlockedBanner } from '../../../components/cart/CartBlockedBanner'

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

import { vi } from 'vitest'

describe('CartBlockedBanner', () => {
  it('renders the banner with the paying message key', () => {
    const { container } = render(<CartBlockedBanner />)
    expect(screen.getByText('cart.blocked.paying.banner')).toBeTruthy()
    expect(container.firstChild).toBeTruthy()
  })

  it('has correct CSS classes for orange styling', () => {
    const { container } = render(<CartBlockedBanner />)
    const div = container.firstChild as HTMLElement
    expect(div.className).toContain('bg-orange-50')
    expect(div.className).toContain('border-orange-200')
  })
})
