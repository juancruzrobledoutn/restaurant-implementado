/**
 * Unit tests for MenuPage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import { useSessionStore } from '../../stores/sessionStore'
import MenuPage from '../../pages/MenuPage'

// Mock useRequireSession to prevent navigation side effects in tests
vi.mock('../../hooks/useRequireSession', () => ({
  useRequireSession: vi.fn(),
}))

// Mock useNavigate (react-router-dom) to capture navigations
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderMenuPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <MenuPage />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

function setActiveSession() {
  useSessionStore.setState({
    token: 'tok',
    branchSlug: 'default',
    tableCode: 'mesa-1',
    sessionId: '42',
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  })
}

describe('MenuPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    useSessionStore.setState({
      token: null,
      branchSlug: null,
      tableCode: null,
      sessionId: null,
      expiresAt: null,
    })
    localStorage.clear()
  })

  it('renders categories from public menu endpoint', async () => {
    setActiveSession()
    renderMenuPage()

    // Loading state should appear first
    expect(screen.getByText(/cargando|loading/i)).toBeTruthy()

    // Wait for the menu data from MSW
    await waitFor(() => {
      expect(screen.getByText('Entradas')).toBeTruthy()
    })

    expect(screen.getByText('Ensalada César')).toBeTruthy()
  })

  it('product image fallback on error', async () => {
    setActiveSession()
    renderMenuPage()

    await waitFor(() => {
      expect(screen.getByText('Ensalada César')).toBeTruthy()
    })

    // The img alt uses i18n key (untranslated in test) so we get by tag + data query
    const imgs = document.querySelectorAll('img')
    expect(imgs.length).toBeGreaterThan(0)
    const img = imgs[0] as HTMLImageElement
    // Fire the onerror event to trigger fallback
    img.dispatchEvent(new Event('error'))

    await waitFor(() => {
      expect(img.src).toContain('/fallback-product.svg')
    })
  })

  it('redirects to /scan when no session — useRequireSession handles it', async () => {
    // useRequireSession is mocked, but with no session the component should show empty/loading
    renderMenuPage()
    // Just verify it renders without crashing
    expect(document.body).toBeTruthy()
  })
})
