/**
 * Component tests — render + key interactions (task 12.9).
 *
 * Components tested:
 * - RoundCard: status label, Confirmar button visibility, disabled state
 * - ServiceCallItem: ACK/Close button visibility, status badge
 * - CompactMenuGrid: renders products, add button, loading/error states
 * - CartDrawer: renders items, quantity controls, Enviar comanda disabled when empty
 * - OfflineBanner: shows when offline / has pending entries / has failed entries
 * - StaleDataBanner: shows when isStaleData=true, hidden otherwise
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoundCard } from '@/components/RoundCard'
import { ServiceCallItem } from '@/components/ServiceCallItem'
import { CompactMenuGrid } from '@/components/CompactMenuGrid'
import { CartDrawer } from '@/components/CartDrawer'
import { OfflineBanner } from '@/components/OfflineBanner'
import { StaleDataBanner } from '@/components/StaleDataBanner'
import { useCompactMenuStore } from '@/stores/compactMenuStore'
import { useWaiterCartStore } from '@/stores/waiterCartStore'
import { useRetryQueueStore } from '@/stores/retryQueueStore'
import { useWaiterWsStore } from '@/stores/waiterWsStore'
import type { Round } from '@/stores/roundsStore'
import type { ServiceCallDTO } from '@/services/waiter'

// ---------------------------------------------------------------------------
// RoundCard
// ---------------------------------------------------------------------------

describe('RoundCard', () => {
  const baseRound: Round = {
    id: 'r-abc-123456',
    sessionId: 'sess-1',
    status: 'PENDING',
    items: [{ id: 'i-1', productId: 'p-100', quantity: 2 }],
    createdAt: '2026-04-18T10:00:00Z',
  }

  it('renders PENDING status label', () => {
    render(<RoundCard round={baseRound} />)
    expect(screen.getByText(/Pendiente de confirmación/i)).toBeInTheDocument()
  })

  it('shows "Confirmar pedido" button when status is PENDING and onConfirm is provided', () => {
    const onConfirm = vi.fn()
    render(<RoundCard round={baseRound} onConfirm={onConfirm} />)
    expect(screen.getByRole('button', { name: /Confirmar pedido/i })).toBeInTheDocument()
  })

  it('calls onConfirm with roundId when button is clicked', () => {
    const onConfirm = vi.fn()
    render(<RoundCard round={baseRound} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /Confirmar pedido/i }))
    expect(onConfirm).toHaveBeenCalledWith(baseRound.id)
  })

  it('does NOT show Confirmar button when status is CONFIRMED', () => {
    const round: Round = { ...baseRound, status: 'CONFIRMED' }
    const onConfirm = vi.fn()
    render(<RoundCard round={round} onConfirm={onConfirm} />)
    expect(screen.queryByRole('button', { name: /Confirmar/i })).toBeNull()
  })

  it('shows disabled button when isPending=true', () => {
    const onConfirm = vi.fn()
    render(<RoundCard round={baseRound} onConfirm={onConfirm} isPending />)
    const btn = screen.getByRole('button', { name: /Confirmando/i })
    expect(btn).toBeDisabled()
  })

  it('renders item quantity and productId fragment (fallback when no menu loaded)', () => {
    render(<RoundCard round={baseRound} />)
    expect(screen.getByText(/2×/)).toBeInTheDocument()
  })

  it('shows product name from compactMenuStore when available — NOT "Producto #..."', () => {
    // Seed the compact menu store with the product
    useCompactMenuStore.setState({
      status: 'ready',
      branchId: '1',
      products: [
        { id: 'p-100', name: 'Milanesa napolitana', priceCents: 2500, subcategoryId: '10', isAvailable: true },
      ],
      categories: [],
    })

    const round: Round = {
      id: 'r-abc-999',
      sessionId: 'sess-1',
      status: 'CONFIRMED',
      items: [{ id: 'i-1', productId: 'p-100', quantity: 1 }],
      createdAt: '2026-04-18T10:00:00Z',
    }

    render(<RoundCard round={round} />)

    // Should show the real name
    expect(screen.getByText(/Milanesa napolitana/i)).toBeInTheDocument()

    // Should NOT show the placeholder format
    expect(screen.queryByText(/Producto #/i)).toBeNull()
  })

  it('falls back to "Producto #<id>" when product is not in compactMenuStore', () => {
    useCompactMenuStore.setState({
      status: 'idle',
      branchId: null,
      products: [],
      categories: [],
    })

    const round: Round = {
      id: 'r-abc-fallback',
      sessionId: 'sess-1',
      status: 'PENDING',
      items: [{ id: 'i-1', productId: 'p-9999', quantity: 3 }],
      createdAt: '2026-04-18T10:00:00Z',
    }

    render(<RoundCard round={round} onConfirm={vi.fn()} />)

    // Fallback defensive label when product is not cached
    expect(screen.getByText(/Producto #p-9999/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// ServiceCallItem
// ---------------------------------------------------------------------------

describe('ServiceCallItem', () => {
  const openCall: ServiceCallDTO = {
    id: 'c-1',
    tableId: 't-3',
    sectorId: 's-5',
    status: 'OPEN',
    createdAt: '2026-04-18T10:00:00Z',
    ackedAt: null,
  }

  it('shows tableId', () => {
    render(<ServiceCallItem call={openCall} />)
    expect(screen.getByText(/Mesa t-3/i)).toBeInTheDocument()
  })

  it('shows "Acusar recibo" button for OPEN call when onAck provided', () => {
    const onAck = vi.fn()
    render(<ServiceCallItem call={openCall} onAck={onAck} />)
    expect(screen.getByRole('button', { name: /Acusar recibo/i })).toBeInTheDocument()
  })

  it('calls onAck with id when ACK button is clicked', () => {
    const onAck = vi.fn()
    render(<ServiceCallItem call={openCall} onAck={onAck} />)
    fireEvent.click(screen.getByRole('button', { name: /Acusar recibo/i }))
    expect(onAck).toHaveBeenCalledWith('c-1')
  })

  it('shows "Cerrar" button when onClose provided and status !== CLOSED', () => {
    const onClose = vi.fn()
    render(<ServiceCallItem call={openCall} onClose={onClose} />)
    expect(screen.getByRole('button', { name: /Cerrar/i })).toBeInTheDocument()
  })

  it('calls onClose with id when Cerrar button is clicked', () => {
    const onClose = vi.fn()
    render(<ServiceCallItem call={openCall} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /Cerrar/i }))
    expect(onClose).toHaveBeenCalledWith('c-1')
  })

  it('shows "Visto" badge for ACKED call', () => {
    const ackedCall: ServiceCallDTO = {
      ...openCall,
      status: 'ACKED',
      ackedAt: '2026-04-18T10:01:00Z',
    }
    render(<ServiceCallItem call={ackedCall} />)
    expect(screen.getByText('Visto')).toBeInTheDocument()
  })

  it('hides ACK button for ACKED call (not OPEN)', () => {
    const ackedCall: ServiceCallDTO = { ...openCall, status: 'ACKED', ackedAt: '' }
    const onAck = vi.fn()
    render(<ServiceCallItem call={ackedCall} onAck={onAck} />)
    expect(screen.queryByRole('button', { name: /Acusar recibo/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// CompactMenuGrid
// ---------------------------------------------------------------------------

describe('CompactMenuGrid', () => {
  beforeEach(() => {
    useCompactMenuStore.getState().reset()
  })

  it('shows loading state', () => {
    useCompactMenuStore.setState({ status: 'loading', products: [], categories: [], branchId: null })
    render(<CompactMenuGrid onAddItem={vi.fn()} />)
    expect(screen.getByText(/Cargando menú/i)).toBeInTheDocument()
  })

  it('shows error state', () => {
    useCompactMenuStore.setState({ status: 'error', error: 'Red no disponible', products: [], categories: [], branchId: null })
    render(<CompactMenuGrid onAddItem={vi.fn()} />)
    expect(screen.getByText(/Red no disponible/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument()
  })

  it('renders product cards when ready', () => {
    useCompactMenuStore.setState({
      status: 'ready',
      branchId: '1',
      products: [
        { id: '100', name: 'Agua', priceCents: 500, subcategoryId: '10', isAvailable: true },
        { id: '101', name: 'Gaseosa', priceCents: 800, subcategoryId: '10', isAvailable: true },
      ],
      categories: [],
    })
    render(<CompactMenuGrid onAddItem={vi.fn()} />)
    expect(screen.getByText('Agua')).toBeInTheDocument()
    expect(screen.getByText('Gaseosa')).toBeInTheDocument()
  })

  it('calls onAddItem with productId when "+" button is clicked', () => {
    useCompactMenuStore.setState({
      status: 'ready',
      branchId: '1',
      products: [{ id: '100', name: 'Agua', priceCents: 500, subcategoryId: '10', isAvailable: true }],
      categories: [],
    })
    const onAddItem = vi.fn()
    render(<CompactMenuGrid onAddItem={onAddItem} />)
    fireEvent.click(screen.getByRole('button', { name: /Agregar Agua/i }))
    expect(onAddItem).toHaveBeenCalledWith('100')
  })

  it('does not render unavailable products', () => {
    useCompactMenuStore.setState({
      status: 'ready',
      branchId: '1',
      products: [
        { id: '100', name: 'Agua', priceCents: 500, subcategoryId: '10', isAvailable: true },
        { id: '101', name: 'Oculto', priceCents: 800, subcategoryId: '10', isAvailable: false },
      ],
      categories: [],
    })
    render(<CompactMenuGrid onAddItem={vi.fn()} />)
    expect(screen.getByText('Agua')).toBeInTheDocument()
    expect(screen.queryByText('Oculto')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// CartDrawer
// ---------------------------------------------------------------------------

describe('CartDrawer', () => {
  beforeEach(() => {
    useWaiterCartStore.setState({ bySession: {} })
    useCompactMenuStore.setState({ status: 'ready', products: [], categories: [], branchId: '1' })
  })

  it('renders nothing when isOpen=false', () => {
    const { container } = render(
      <CartDrawer sessionId="sess-1" isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the drawer when isOpen=true', () => {
    render(
      <CartDrawer sessionId="sess-1" isOpen onClose={vi.fn()} onSubmit={vi.fn()} />,
    )
    expect(screen.getByRole('dialog', { name: /Carrito de comanda/i })).toBeInTheDocument()
  })

  it('shows empty state message when cart is empty', () => {
    render(
      <CartDrawer sessionId="sess-1" isOpen onClose={vi.fn()} onSubmit={vi.fn()} />,
    )
    expect(screen.getByText(/No hay items en la comanda todavía/i)).toBeInTheDocument()
  })

  it('"Enviar comanda" button is disabled when cart is empty', () => {
    render(
      <CartDrawer sessionId="sess-1" isOpen onClose={vi.fn()} onSubmit={vi.fn()} />,
    )
    const btn = screen.getByRole('button', { name: /Enviar comanda/i })
    expect(btn).toBeDisabled()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <CartDrawer sessionId="sess-1" isOpen onClose={onClose} onSubmit={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cerrar/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onSubmit when Enviar comanda is clicked with items', () => {
    useWaiterCartStore.setState({
      bySession: {
        'sess-1': [{ productId: 'p-1', quantity: 1 }],
      },
    })
    const onSubmit = vi.fn()
    render(
      <CartDrawer sessionId="sess-1" isOpen onClose={vi.fn()} onSubmit={onSubmit} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Enviar comanda/i }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// OfflineBanner
// ---------------------------------------------------------------------------

describe('OfflineBanner', () => {
  beforeEach(() => {
    useRetryQueueStore.setState({ entries: [], isDraining: false })
    // Ensure navigator.onLine = true
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true })
  })

  it('renders nothing when online with no pending/failed entries', () => {
    const { container } = render(<OfflineBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('shows pending operations count when queue has pending entries', () => {
    useRetryQueueStore.setState({
      entries: [
        { id: 'u-1:e1', op: 'createRound', payload: null, clientOpId: 'op-1', createdAt: Date.now(), attempts: 0, nextAttemptAt: Date.now() },
        { id: 'u-1:e2', op: 'confirmRound', payload: null, clientOpId: 'op-2', createdAt: Date.now(), attempts: 0, nextAttemptAt: Date.now() },
      ],
    })
    render(<OfflineBanner />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/2 operaciones pendientes/i)).toBeInTheDocument()
  })

  it('shows failed operations message when queue has failed entries', () => {
    useRetryQueueStore.setState({
      entries: [
        { id: 'u-1:e1', op: 'createRound', payload: null, clientOpId: 'op-1', createdAt: Date.now(), attempts: 10, nextAttemptAt: Date.now(), failed: true },
      ],
    })
    render(<OfflineBanner />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/1 operación fallida/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// StaleDataBanner
// ---------------------------------------------------------------------------

describe('StaleDataBanner', () => {
  beforeEach(() => {
    useWaiterWsStore.setState({ isConnected: false, reconnectAttempts: 0, isStaleData: false })
  })

  it('renders nothing when isStaleData=false', () => {
    const { container } = render(<StaleDataBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the stale data alert when isStaleData=true', () => {
    useWaiterWsStore.setState({ isStaleData: true })
    render(<StaleDataBanner />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/Datos pueden estar desactualizados/i)).toBeInTheDocument()
  })

  it('shows "Actualizar" button', () => {
    useWaiterWsStore.setState({ isStaleData: true })
    render(<StaleDataBanner />)
    expect(screen.getByRole('button', { name: /Actualizar/i })).toBeInTheDocument()
  })
})
