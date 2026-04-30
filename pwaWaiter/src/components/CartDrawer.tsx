/**
 * CartDrawer — slide-in drawer showing cart items and "Enviar comanda" button.
 */
import { useMemo } from 'react'
import { useWaiterCartStore, useCartItems } from '@/stores/waiterCartStore'
import { useCompactMenuStore, selectAllProducts } from '@/stores/compactMenuStore'
import { computeCartTotalCents, formatPriceCents } from '@/lib/cartMath'

interface Props {
  sessionId: string
  isOpen: boolean
  onClose: () => void
  onSubmit: () => void
  isSubmitting?: boolean
}

export function CartDrawer({ sessionId, isOpen, onClose, onSubmit, isSubmitting = false }: Props) {
  const items = useCartItems(sessionId)
  const products = useCompactMenuStore(selectAllProducts)
  const updateQuantity = useWaiterCartStore((s) => s.updateQuantity)
  const removeItem = useWaiterCartStore((s) => s.removeItem)

  const totalCents = useMemo(
    () => computeCartTotalCents(items, products),
    [items, products],
  )

  const isEmpty = items.length === 0

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-sm flex-col bg-white shadow-xl"
        role="dialog"
        aria-label="Carrito de comanda"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Comanda</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isEmpty ? (
            <p className="py-8 text-center text-sm text-gray-500">
              No hay items en la comanda todavía.
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => {
                const product = products.find((p) => p.id === item.productId)
                return (
                  <li
                    key={item.productId}
                    className="flex items-center gap-3 rounded-lg bg-gray-50 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-800">
                        {product?.name ?? `Producto #${item.productId.slice(-4)}`}
                      </p>
                      {product && (
                        <p className="text-xs text-gray-500">
                          {formatPriceCents(product.priceCents)} c/u
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateQuantity(sessionId, item.productId, item.quantity - 1)}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-sm font-bold hover:bg-gray-300"
                        aria-label="Reducir cantidad"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(sessionId, item.productId, item.quantity + 1)}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-sm font-bold hover:bg-gray-300"
                        aria-label="Aumentar cantidad"
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItem(sessionId, item.productId)}
                      className="text-gray-400 hover:text-red-500"
                      aria-label="Eliminar"
                    >
                      🗑
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t px-4 py-4">
          <div className="mb-3 flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span className="text-primary">{formatPriceCents(totalCents)}</span>
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={isEmpty || isSubmitting}
            className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          >
            {isSubmitting ? 'Enviando…' : 'Enviar comanda'}
          </button>
        </div>
      </div>
    </>
  )
}
