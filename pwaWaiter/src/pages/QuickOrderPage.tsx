/**
 * QuickOrderPage — /tables/:tableId/quick-order
 *
 * Shows compact menu grid + CartDrawer. Waiter adds items and submits as round.
 * Cart is scoped by sessionId. Round is created CONFIRMED (waiter-side orders
 * skip PENDING).
 */
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, selectUser } from '@/stores/authStore'
import { useTableStore, selectTableById } from '@/stores/tableStore'
import { useCompactMenuStore } from '@/stores/compactMenuStore'
import { useWaiterCartStore } from '@/stores/waiterCartStore'
import { useRoundsStore } from '@/stores/roundsStore'
import { CompactMenuGrid } from '@/components/CompactMenuGrid'
import { CartDrawer } from '@/components/CartDrawer'
import { OfflineBanner } from '@/components/OfflineBanner'
import { createWaiterRound } from '@/services/waiter'
import { generateClientOpId } from '@/lib/idempotency'
import { logger } from '@/utils/logger'
import { useEffect } from 'react'

export default function QuickOrderPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const navigate = useNavigate()

  const user = useAuthStore(selectUser)
  const table = useTableStore(selectTableById(tableId ?? ''))
  const sessionId = table?.sessionId ?? null
  const branchId = user?.branchIds[0] ?? null

  const loadMenu = useCompactMenuStore((s) => s.loadMenu)
  const addItem = useWaiterCartStore((s) => s.addItem)
  const clearCart = useWaiterCartStore((s) => s.clearCart)
  const upsertRound = useRoundsStore((s) => s.upsertRound)

  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Load compact menu for this branch on mount
  useEffect(() => {
    if (branchId) {
      void loadMenu(branchId)
    }
  }, [branchId, loadMenu])

  if (!table || !sessionId) {
    return (
      <div className="p-4 text-sm text-gray-600">
        Mesa sin sesión activa.{' '}
        <button
          type="button"
          onClick={() => void navigate(`/tables/${tableId}`)}
          className="text-primary underline"
        >
          Volver al detalle
        </button>
      </div>
    )
  }

  function handleAddItem(productId: string) {
    if (!sessionId) return
    addItem(sessionId, productId, 1)
    setIsCartOpen(true)
  }

  async function handleSubmitRound() {
    if (!sessionId) return
    setIsSubmitting(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    const items = useWaiterCartStore.getState().bySession[sessionId] ?? []
    if (items.length === 0) return

    try {
      const clientOpId = generateClientOpId()
      const round = await createWaiterRound(
        sessionId,
        { items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, notes: i.notes })) },
        clientOpId,
      )
      upsertRound(round)
      clearCart(sessionId)
      setIsCartOpen(false)
      setSuccessMsg('Comanda enviada')
      setTimeout(() => setSuccessMsg(null), 3000)
    } catch (err) {
      logger.error('QuickOrderPage: createWaiterRound failed', err)
      setErrorMsg('Error al enviar la comanda. Se reintentará cuando vuelva la conexión.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden w-full max-w-full">
      <OfflineBanner />

      <div className="p-4">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void navigate(`/tables/${tableId}`)}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Volver"
            >
              ←
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Comanda rápida</h1>
              <p className="text-xs text-gray-600">Mesa {table.code}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="relative rounded-full bg-primary p-2 text-white shadow"
            aria-label="Abrir carrito"
          >
            🛒
          </button>
        </div>

        {successMsg && (
          <div className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <CompactMenuGrid onAddItem={handleAddItem} />
      </div>

      <CartDrawer
        sessionId={sessionId}
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        onSubmit={() => void handleSubmitRound()}
        isSubmitting={isSubmitting}
      />
    </div>
  )
}
