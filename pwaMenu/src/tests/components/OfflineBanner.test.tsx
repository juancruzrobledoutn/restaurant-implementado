/**
 * Tests for OfflineBanner component (pwaMenu).
 *
 * Tests:
 * - renders nothing when CONNECTED and no pending entries
 * - shows disconnected banner when state is RECONNECTING
 * - shows disconnected banner when state is DISCONNECTED
 * - shows pending count when CONNECTED but queue has entries
 * - shows both messages when disconnected AND pending entries exist
 * - cleans up the connection listener on unmount
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// ─── Mock i18next ─────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'offline.banner.disconnected': 'Sin conexión — reconectando...',
        'offline.banner.pending': `${opts?.count ?? 0} acción(es) pendiente(s)`,
      }
      return map[key] ?? key
    },
  }),
}))

// ─── Mock retryQueueStore ─────────────────────────────────────────────────────
let mockPendingCount = 0

vi.mock('../../stores/retryQueueStore', () => ({
  useRetryQueueStore: (selector: (s: { queue: unknown[] }) => unknown) =>
    selector({ queue: Array.from({ length: mockPendingCount }) }),
  selectPendingCount: (s: { queue: unknown[] }) => s.queue.length,
}))

// ─── Mock dinerWS ─────────────────────────────────────────────────────────────
type ConnectionListener = (state: string) => void
let registeredListener: ConnectionListener | null = null
let currentState = 'CONNECTED'

vi.mock('../../services/ws/dinerWS', () => ({
  dinerWS: {
    getState: () => currentState,
    onConnectionChange: (listener: ConnectionListener) => {
      registeredListener = listener
      // Immediately invoke with current state (matches real implementation)
      listener(currentState)
      return () => {
        registeredListener = null
      }
    },
  },
}))

import { OfflineBanner } from '../../components/OfflineBanner'

describe('OfflineBanner', () => {
  beforeEach(() => {
    mockPendingCount = 0
    currentState = 'CONNECTED'
    registeredListener = null
  })

  it('renders nothing when CONNECTED and no pending entries', () => {
    const { container } = render(<OfflineBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('shows disconnected banner when state is RECONNECTING', () => {
    currentState = 'RECONNECTING'
    render(<OfflineBanner />)
    expect(screen.getByText('Sin conexión — reconectando...')).toBeInTheDocument()
  })

  it('shows disconnected banner when state is DISCONNECTED', () => {
    currentState = 'DISCONNECTED'
    render(<OfflineBanner />)
    expect(screen.getByText('Sin conexión — reconectando...')).toBeInTheDocument()
  })

  it('renders nothing when AUTH_FAILED (non-reconnectable — handled elsewhere)', () => {
    currentState = 'AUTH_FAILED'
    const { container } = render(<OfflineBanner />)
    // AUTH_FAILED is a terminal state — the app redirects; banner stays hidden
    expect(container.firstChild).toBeNull()
  })

  it('shows pending count when CONNECTED but queue has entries', () => {
    mockPendingCount = 3
    render(<OfflineBanner />)
    expect(screen.getByText('3 acción(es) pendiente(s)')).toBeInTheDocument()
  })

  it('shows both messages when disconnected AND pending entries exist', () => {
    currentState = 'RECONNECTING'
    mockPendingCount = 2
    render(<OfflineBanner />)
    expect(screen.getByText('Sin conexión — reconectando...')).toBeInTheDocument()
    expect(screen.getByText('2 acción(es) pendiente(s)')).toBeInTheDocument()
  })

  it('updates when connection state changes dynamically', () => {
    currentState = 'CONNECTED'
    render(<OfflineBanner />)
    expect(screen.queryByText('Sin conexión — reconectando...')).not.toBeInTheDocument()

    act(() => {
      registeredListener?.('RECONNECTING')
    })

    expect(screen.getByText('Sin conexión — reconectando...')).toBeInTheDocument()
  })

  it('hides banner when connection is restored', () => {
    currentState = 'RECONNECTING'
    render(<OfflineBanner />)
    expect(screen.getByText('Sin conexión — reconectando...')).toBeInTheDocument()

    act(() => {
      registeredListener?.('CONNECTED')
    })

    expect(screen.queryByText('Sin conexión — reconectando...')).not.toBeInTheDocument()
  })

  it('unregisters the listener on unmount', () => {
    currentState = 'CONNECTED'
    const { unmount } = render(<OfflineBanner />)
    expect(registeredListener).not.toBeNull()

    unmount()

    expect(registeredListener).toBeNull()
  })
})
