/**
 * CompactMenuGrid — grid of available products for the quick-order flow.
 * Prices displayed from cents. "+" button adds to cart.
 */
import { useCompactMenuStore, selectAllProducts } from '@/stores/compactMenuStore'
import { formatPriceCents } from '@/lib/cartMath'

interface Props {
  onAddItem: (productId: string) => void
}

export function CompactMenuGrid({ onAddItem }: Props) {
  const products = useCompactMenuStore(selectAllProducts)
  const status = useCompactMenuStore((s) => s.status)
  const error = useCompactMenuStore((s) => s.error)
  const loadMenu = useCompactMenuStore((s) => s.loadMenu)
  const branchId = useCompactMenuStore((s) => s.branchId)

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-500">
        Cargando menú…
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-red-600">{error ?? 'Error al cargar el menú'}</p>
        <button
          type="button"
          onClick={() => branchId && void loadMenu(branchId)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
        >
          Reintentar
        </button>
      </div>
    )
  }

  const availableProducts = products.filter((p) => p.isAvailable)

  if (availableProducts.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">
        No hay productos disponibles en este momento.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {availableProducts.map((product) => (
        <div
          key={product.id}
          className="flex flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
        >
          <span className="mb-1 flex-1 text-sm font-medium text-gray-800 leading-tight">
            {product.name}
          </span>
          <div className="mt-auto flex items-center justify-between">
            <span className="text-sm font-semibold text-primary">
              {formatPriceCents(product.priceCents)}
            </span>
            <button
              type="button"
              onClick={() => onAddItem(product.id)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-lg font-bold text-white hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label={`Agregar ${product.name}`}
            >
              +
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
