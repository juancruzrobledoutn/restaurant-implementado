/**
 * Layout tests for CartPage — verifies mobile constraints.
 * Tests: overflow-x-hidden, w-full, max-w-full on root container.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock all dependencies so we can render just the layout
vi.mock('../../hooks/useRequireSession', () => ({
  useRequireSession: vi.fn(),
}))
vi.mock('../../hooks/useSessionStatusGuard', () => ({
  useSessionStatusGuard: vi.fn(),
}))
vi.mock('../../hooks/useOptimisticCart', () => ({
  useOptimisticCart: () => ({
    items: [],
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateItem: vi.fn(),
  }),
}))
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (selector: (s: unknown) => unknown) => {
    const state = { dinerId: '8', tableStatus: 'OPEN', token: 'tok', isPaying: false }
    return typeof selector === 'function' ? selector(state) : state
  },
  selectDinerId: (s: { dinerId: string }) => s.dinerId,
  selectIsPaying: (s: { tableStatus: string }) => s.tableStatus === 'PAYING',
}))
vi.mock('../../stores/cartStore', () => ({
  useCartStore: (selector: (s: unknown) => unknown) => {
    const state = { items: {}, _processedIds: [] }
    return typeof selector === 'function' ? selector(state) : state
  },
  selectTotalCents: () => 0,
  selectConfirmedTotalCents: () => 0,
  selectItemCount: () => 0,
  selectItems: () => [],
  selectMyItems: () => () => [],
  selectSharedItems: () => () => [],
  EMPTY_ARRAY: [],
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es' },
  }),
}))

import CartPage from '../../pages/CartPage'

describe('CartPage — mobile layout', () => {
  it('root container has overflow-x-hidden, w-full, max-w-full', () => {
    const { container } = render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>,
    )
    // AppShell applies these classes
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('overflow-x-hidden')
    expect(root.className).toContain('w-full')
    expect(root.className).toContain('max-w-full')
  })
})
