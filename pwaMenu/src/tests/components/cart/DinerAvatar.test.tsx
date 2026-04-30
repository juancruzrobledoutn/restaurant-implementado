/**
 * Tests for DinerAvatar component.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DinerAvatar } from '../../../components/cart/DinerAvatar'

describe('DinerAvatar', () => {
  it('renders initial letter of diner name', () => {
    const { getByText } = render(<DinerAvatar dinerId="8" dinerName="Carlos" />)
    expect(getByText('C')).toBeTruthy()
  })

  it('applies deterministic background color', () => {
    const { container } = render(<DinerAvatar dinerId="0" dinerName="Test" />)
    const div = container.firstChild as HTMLElement
    // Color should be set as inline style
    expect(div.style.backgroundColor).toBeTruthy()
    expect(div.style.backgroundColor).not.toBe('')
  })

  it('uses ? fallback for empty name', () => {
    const { getByText } = render(<DinerAvatar dinerId="1" dinerName="" />)
    expect(getByText('?')).toBeTruthy()
  })

  it('applies sm size classes by default', () => {
    const { container } = render(<DinerAvatar dinerId="1" dinerName="Ana" />)
    const div = container.firstChild as HTMLElement
    expect(div.className).toContain('w-6')
    expect(div.className).toContain('h-6')
  })

  it('applies md size when specified', () => {
    const { container } = render(<DinerAvatar dinerId="1" dinerName="Ana" size="md" />)
    const div = container.firstChild as HTMLElement
    expect(div.className).toContain('w-8')
    expect(div.className).toContain('h-8')
  })
})
