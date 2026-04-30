/**
 * Tests for CartItem component.
 *
 * Includes WCAG 2.5.5 touch-target regression test:
 * All interactive buttons must have a minimum touch target of 44×44px
 * (implemented via min-w-[44px] min-h-[44px] Tailwind classes).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CartItem } from '../../../components/cart/CartItem'
import type { CartItem as CartItemType } from '../../../types/cart'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const ITEM: CartItemType = {
  id: 'item-1',
  productId: 'prod-1',
  productName: 'Milanesa napolitana',
  quantity: 2,
  notes: 'sin sal',
  priceCentsSnapshot: 120_00,
  dinerId: 'diner-1',
  dinerName: 'Juan',
  pending: false,
  addedAt: new Date().toISOString(),
}

describe('CartItem', () => {
  it('renders product name and notes', () => {
    render(
      <CartItem
        item={ITEM}
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.getByText('Milanesa napolitana')).toBeInTheDocument()
    expect(screen.getByText('sin sal')).toBeInTheDocument()
  })

  it('calls onIncrement when + button is clicked', () => {
    const onIncrement = vi.fn()
    render(
      <CartItem
        item={ITEM}
        onIncrement={onIncrement}
        onDecrement={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText('cart.increment'))
    expect(onIncrement).toHaveBeenCalledWith('item-1')
  })

  it('calls onDecrement when − button is clicked and quantity > 1', () => {
    const onDecrement = vi.fn()
    render(
      <CartItem
        item={ITEM}
        onIncrement={vi.fn()}
        onDecrement={onDecrement}
        onRemove={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText('cart.decrement'))
    expect(onDecrement).toHaveBeenCalledWith('item-1')
  })

  it('calls onRemove when − button is clicked and quantity === 1', () => {
    const onRemove = vi.fn()
    render(
      <CartItem
        item={{ ...ITEM, quantity: 1 }}
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
        onRemove={onRemove}
      />,
    )
    fireEvent.click(screen.getByLabelText('cart.decrement'))
    expect(onRemove).toHaveBeenCalledWith('item-1')
  })

  it('shows pending spinner when item is pending', () => {
    const { container } = render(
      <CartItem
        item={{ ...ITEM, pending: true }}
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    // Spinner is a div with animate-spin class
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  // ─── WCAG 2.5.5 touch target regression ────────────────────────────────────
  describe('WCAG 2.5.5 — touch target size (min 44×44px)', () => {
    it('decrement/remove button has min-w-[44px] and min-h-[44px]', () => {
      render(
        <CartItem
          item={ITEM}
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      const decrementBtn = screen.getByLabelText('cart.decrement')
      expect(decrementBtn.className).toContain('min-w-[44px]')
      expect(decrementBtn.className).toContain('min-h-[44px]')
    })

    it('increment button has min-w-[44px] and min-h-[44px]', () => {
      render(
        <CartItem
          item={ITEM}
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      const incrementBtn = screen.getByLabelText('cart.increment')
      expect(incrementBtn.className).toContain('min-w-[44px]')
      expect(incrementBtn.className).toContain('min-h-[44px]')
    })

    it('remove button has min-w-[44px] and min-h-[44px]', () => {
      render(
        <CartItem
          item={ITEM}
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      const removeBtn = screen.getByLabelText('cart.remove')
      expect(removeBtn.className).toContain('min-w-[44px]')
      expect(removeBtn.className).toContain('min-h-[44px]')
    })
  })
})
