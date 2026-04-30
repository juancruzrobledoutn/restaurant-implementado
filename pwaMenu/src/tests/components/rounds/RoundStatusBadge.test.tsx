/**
 * Tests for RoundStatusBadge component.
 * Tests: badge text via t(), READY pulse animation, SERVED green, CANCELED gray.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { RoundStatusBadge } from '../../../components/rounds/RoundStatusBadge'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('RoundStatusBadge', () => {
  it('renders PENDING status', () => {
    const { getByText } = render(<RoundStatusBadge status="PENDING" />)
    expect(getByText('rounds.status.pending')).toBeTruthy()
  })

  it('renders READY status with pulse animation', () => {
    const { container } = render(<RoundStatusBadge status="READY" />)
    const pulseDot = container.querySelector('.animate-pulse')
    expect(pulseDot).toBeTruthy()
  })

  it('renders SERVED status with green classes', () => {
    const { container } = render(<RoundStatusBadge status="SERVED" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-green-100')
  })

  it('renders CANCELED status with gray classes', () => {
    const { container } = render(<RoundStatusBadge status="CANCELED" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-gray-100')
  })

  it('renders IN_KITCHEN with yellow classes', () => {
    const { container } = render(<RoundStatusBadge status="IN_KITCHEN" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-yellow-100')
  })
})
