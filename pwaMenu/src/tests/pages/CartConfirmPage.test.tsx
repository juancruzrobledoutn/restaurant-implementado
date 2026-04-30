/**
 * Integration tests for CartConfirmPage with MSW.
 *
 * Tests:
 * - Submit success navigates to /rounds
 * - 409 session_paying redirects to /menu
 * - Blocked banner visible when tableStatus === 'PAYING'
 * - Empty cart hides submit button
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { useSessionStore } from '../../stores/sessionStore'
import { useCartStore } from '../../stores/cartStore'
import { useRoundsStore } from '../../stores/roundsStore'

// ─── Mock navigation hooks ────────────────────────────────────────────────────
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// ─── Mock guard hooks (no-op in tests) ───────────────────────────────────────
vi.mock('../../hooks/useRequireSession', () => ({
  useRequireSession: vi.fn(),
}))
vi.mock('../../hooks/useSessionStatusGuard', () => ({
  useSessionStatusGuard: vi.fn(),
}))

// ─── Mock i18n ────────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) return `${key}(${JSON.stringify(opts)})`
      return key
    },
    i18n: { language: 'es' },
  }),
}))

import CartConfirmPage from '../../pages/CartConfirmPage'

// Stable cart item for tests
const CART_ITEM = {
  id: '101',
  productId: 'prod-42',
  productName: 'Ensalada César',
  quantity: 2,
  notes: '',
  priceCentsSnapshot: 125050,
  dinerId: 'diner-1',
  dinerName: 'Juan',
  addedAt: new Date().toISOString(),
  pending: false,
}

function renderCartConfirmPage() {
  return render(
    <MemoryRouter initialEntries={['/cart/confirm']}>
      <CartConfirmPage />
    </MemoryRouter>,
  )
}

function setCartWithItem() {
  useCartStore.setState({ items: { '101': CART_ITEM }, _processedIds: [] })
}

describe('CartConfirmPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    // Reset stores
    useSessionStore.setState({
      token: 'test-token',
      branchSlug: 'default',
      tableCode: 'mesa-1',
      sessionId: '42',
      dinerId: 'diner-1',
      dinerName: 'Juan',
      tableStatus: 'OPEN',
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    })
    useCartStore.setState({ items: {}, _processedIds: [] })
    useRoundsStore.setState({ rounds: {}, _processedIds: [] })
  })

  it('shows empty cart message when cart is empty', () => {
    renderCartConfirmPage()
    expect(screen.getByText('cart.empty')).toBeTruthy()
  })

  it('shows diner items when cart has items', () => {
    setCartWithItem()
    renderCartConfirmPage()
    // Diner name should appear
    expect(screen.getByText('Juan')).toBeTruthy()
    // Product name
    expect(screen.getByText('Ensalada César')).toBeTruthy()
  })

  it('submit success → navigates to /rounds and clears cart', async () => {
    setCartWithItem()
    server.use(
      http.post('http://localhost:8000/api/diner/rounds', () =>
        HttpResponse.json({
          id: 1,
          session_id: 42,
          round_number: 1,
          status: 'PENDING',
          items: [],
          notes: '',
          submitted_at: new Date().toISOString(),
          ready_at: null,
          served_at: null,
        }),
      ),
    )

    renderCartConfirmPage()

    const submitBtn = screen.getByText('cart.confirm.submit')
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/rounds')
    })

    // Cart should be cleared
    const cartItems = Object.values(useCartStore.getState().items)
    expect(cartItems).toHaveLength(0)
  })

  it('409 session_paying → sets PAYING status and navigates to /menu', async () => {
    setCartWithItem()
    server.use(
      http.post('http://localhost:8000/api/diner/rounds', () =>
        HttpResponse.json(
          { detail: { reason: 'session_paying' } },
          { status: 409 },
        ),
      ),
    )

    renderCartConfirmPage()

    const submitBtn = screen.getByText('cart.confirm.submit')
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/menu')
    })

    expect(useSessionStore.getState().tableStatus).toBe('PAYING')
  })

  it('409 insufficient_stock → shows inline stock error panel', async () => {
    setCartWithItem()
    server.use(
      http.post('http://localhost:8000/api/diner/rounds', () =>
        HttpResponse.json(
          {
            detail: {
              reason: 'insufficient_stock',
              products: [
                {
                  product_id: 42,
                  name: 'Ensalada César',
                  requested: 5,
                  available: 2,
                },
              ],
            },
          },
          { status: 409 },
        ),
      ),
    )

    renderCartConfirmPage()

    const submitBtn = screen.getByText('cart.confirm.submit')
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('errors.cart.insufficient_stock')).toBeTruthy()
    })

    // Should NOT navigate
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows blocked banner and hides submit button when tableStatus is PAYING', () => {
    setCartWithItem()
    useSessionStore.setState({ tableStatus: 'PAYING' })

    renderCartConfirmPage()

    // Blocked banner content should appear (may appear in more than one place in the UI)
    const bannerElements = screen.getAllByText('cart.blocked.paying.banner')
    expect(bannerElements.length).toBeGreaterThan(0)

    // Submit button should NOT be rendered (replaced by banner text)
    expect(screen.queryByRole('button', { name: /submit|confirm/i })).toBeNull()
  })
})
