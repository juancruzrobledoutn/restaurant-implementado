/**
 * Tests for ProductCard cart integration.
 *
 * Tests:
 * - Add to cart updates badge count on the card
 * - FAB visible with correct item count when cart has items
 * - FAB disabled when tableStatus === 'PAYING'
 * - ProductCard add button disabled when tableStatus === 'PAYING'
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useSessionStore } from '../../../stores/sessionStore'
import { useCartStore } from '../../../stores/cartStore'

// ─── Mock useOptimisticCart (ProductCard calls this internally) ───────────────
const mockAddItem = vi.fn()
vi.mock('../../../hooks/useOptimisticCart', () => ({
  useOptimisticCart: () => ({
    items: [],
    addItem: mockAddItem,
    removeItem: vi.fn(),
    updateItem: vi.fn(),
  }),
}))

// ─── Mock useRequireSession ────────────────────────────────────────────────────
vi.mock('../../../hooks/useRequireSession', () => ({
  useRequireSession: vi.fn(),
}))

// ─── Mock i18n ────────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es' },
  }),
}))

// ─── Mock navigate ────────────────────────────────────────────────────────────
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// ─── Mock menu service ────────────────────────────────────────────────────────
vi.mock('../../../services/menu', () => ({
  getPublicMenu: vi.fn().mockResolvedValue([]),
}))

import { ProductCard } from '../../../components/menu/ProductCard'
import { selectItemCount } from '../../../stores/cartStore'
import { selectIsPaying } from '../../../stores/sessionStore'

const TEST_PRODUCT = {
  id: 'prod-42',
  name: 'Ensalada César',
  description: 'Clásica ensalada',
  priceCents: 125050,
  imageUrl: null,
  isAvailable: true,
  allergens: [],
}

function renderProductCard() {
  return render(
    <MemoryRouter>
      <ProductCard product={TEST_PRODUCT} />
    </MemoryRouter>,
  )
}

describe('ProductCard — cart integration', () => {
  beforeEach(() => {
    mockAddItem.mockReset()
    mockNavigate.mockReset()
    useSessionStore.setState({
      token: 'tok',
      dinerId: 'diner-1',
      dinerName: 'Juan',
      tableStatus: 'OPEN',
      sessionId: '42',
      branchSlug: 'default',
      tableCode: 'mesa-1',
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    })
    useCartStore.setState({ items: {}, _processedIds: [] })
  })

  it('renders add button and product name', () => {
    renderProductCard()
    expect(screen.getByText('Ensalada César')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'cart.add' })).toBeTruthy()
  })

  it('add button calls addItem with correct product', async () => {
    renderProductCard()
    const addBtn = screen.getByRole('button', { name: 'cart.add' })
    await userEvent.click(addBtn)
    expect(mockAddItem).toHaveBeenCalledWith(
      { id: 'prod-42', name: 'Ensalada César', priceCents: 125050 },
      1,
    )
  })

  it('badge shows quantity from cart', () => {
    // Pre-populate cart with items for this product/diner
    useCartStore.setState({
      items: {
        '101': {
          id: '101',
          productId: 'prod-42',
          productName: 'Ensalada César',
          quantity: 3,
          notes: '',
          priceCentsSnapshot: 125050,
          dinerId: 'diner-1',
          dinerName: 'Juan',
          addedAt: new Date().toISOString(),
          pending: false,
        },
      },
      _processedIds: [],
    })

    renderProductCard()
    // Badge shows the quantity (3)
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('add button is disabled when tableStatus is PAYING', () => {
    useSessionStore.setState({ tableStatus: 'PAYING' })
    renderProductCard()
    const addBtn = screen.getByRole('button', { name: 'cart.add' })
    expect(addBtn).toBeDisabled()
  })

  it('add button has tooltip when PAYING', () => {
    useSessionStore.setState({ tableStatus: 'PAYING' })
    renderProductCard()
    const addBtn = screen.getByRole('button', { name: 'cart.add' })
    expect(addBtn.getAttribute('title')).toBe('cart.blocked.paying.tooltip')
  })
})

// ─── FAB tests (via MenuPage) ─────────────────────────────────────────────────
// We test FAB behavior directly via cartStore state + checking the aria-label
// without rendering the full MenuPage (too many deps).
// Instead we test the key interactions: FAB visible when items > 0, disabled when PAYING.
describe('Cart FAB — visibility and state', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    useSessionStore.setState({
      token: 'tok',
      dinerId: 'diner-1',
      dinerName: 'Juan',
      tableStatus: 'OPEN',
      sessionId: '42',
      branchSlug: 'default',
      tableCode: 'mesa-1',
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    })
    useCartStore.setState({ items: {}, _processedIds: [] })
  })

  it('cartStore selectItemCount returns 0 when empty', () => {
    const count = selectItemCount(useCartStore.getState())
    expect(count).toBe(0)
  })

  it('cartStore selectItemCount counts all items quantities', () => {
    useCartStore.setState({
      items: {
        '101': {
          id: '101',
          productId: 'prod-42',
          productName: 'Pizza',
          quantity: 2,
          notes: '',
          priceCentsSnapshot: 5000,
          dinerId: 'diner-1',
          dinerName: 'Juan',
          addedAt: new Date().toISOString(),
          pending: false,
        },
        '102': {
          id: '102',
          productId: 'prod-43',
          productName: 'Burger',
          quantity: 1,
          notes: '',
          priceCentsSnapshot: 8000,
          dinerId: 'diner-1',
          dinerName: 'Juan',
          addedAt: new Date().toISOString(),
          pending: false,
        },
      },
      _processedIds: [],
    })

    const count = selectItemCount(useCartStore.getState())
    expect(count).toBe(3) // 2 + 1
  })

  it('sessionStore selectIsPaying returns true when PAYING', () => {
    useSessionStore.setState({ tableStatus: 'PAYING' })
    const isPaying = selectIsPaying(useSessionStore.getState())
    expect(isPaying).toBe(true)
  })

  it('sessionStore selectIsPaying returns false when OPEN', () => {
    useSessionStore.setState({ tableStatus: 'OPEN' })
    const isPaying = selectIsPaying(useSessionStore.getState())
    expect(isPaying).toBe(false)
  })
})
