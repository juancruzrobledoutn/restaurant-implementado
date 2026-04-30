/**
 * CartPage — /cart
 * Shows own editable items + shared read-only items, with totals and Confirm CTA.
 * Mobile-first: overflow-x-hidden w-full max-w-full, safe-area-inset-bottom footer.
 */
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useRequireSession } from '../hooks/useRequireSession'
import { useSessionStatusGuard } from '../hooks/useSessionStatusGuard'
import { useOptimisticCart } from '../hooks/useOptimisticCart'
import { useSessionStore, selectDinerId, selectIsPaying } from '../stores/sessionStore'
import { useCartStore, selectTotalCents, selectConfirmedTotalCents, selectItemCount } from '../stores/cartStore'
import { selectMyItems, selectSharedItems } from '../stores/cartStore'
import { CartItem } from '../components/cart/CartItem'
import { CartSharedItem } from '../components/cart/CartSharedItem'
import { CartTotals } from '../components/cart/CartTotals'
import { CartBlockedBanner } from '../components/cart/CartBlockedBanner'
import { AppShell } from '../components/layout/AppShell'

export default function CartPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  useRequireSession()
  useSessionStatusGuard()

  const dinerId = useSessionStore(selectDinerId) ?? ''
  const isPaying = useSessionStore(selectIsPaying)

  const myItems = useCartStore(useShallow(selectMyItems(dinerId)))
  const sharedItems = useCartStore(useShallow(selectSharedItems(dinerId)))
  const totalCents = useCartStore(selectTotalCents)
  const confirmedTotalCents = useCartStore(selectConfirmedTotalCents)
  const itemCount = useCartStore(selectItemCount)

  const { updateItem, removeItem } = useOptimisticCart()

  const hasPendingItems = myItems.some((item) => item.pending)

  function handleIncrement(itemId: string) {
    const item = myItems.find((i) => i.id === itemId)
    if (item) {
      updateItem(itemId, { quantity: item.quantity + 1 })
    }
  }

  function handleDecrement(itemId: string) {
    const item = myItems.find((i) => i.id === itemId)
    if (item && item.quantity > 1) {
      updateItem(itemId, { quantity: item.quantity - 1 })
    } else {
      removeItem(itemId)
    }
  }

  const allEmpty = myItems.length === 0 && sharedItems.length === 0

  return (
    <AppShell className="bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 pt-[env(safe-area-inset-top,0px)] pt-4 pb-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-500 hover:text-gray-700 transition-colors"
            aria-label={t('common.back')}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-900 flex-1">{t('cart.title')}</h1>
          {itemCount > 0 && (
            <span className="bg-primary text-white text-xs font-semibold px-2 py-0.5 rounded-full">
              {itemCount}
            </span>
          )}
        </div>
      </header>

      <main className="px-4 py-4 pb-32 space-y-4">
        {/* Blocked banner */}
        {isPaying && <CartBlockedBanner />}

        {allEmpty && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-lg mb-2">{t('cart.empty')}</p>
            <button
              onClick={() => navigate('/menu')}
              className="text-primary text-sm hover:underline"
            >
              {t('cart.goToMenu')}
            </button>
          </div>
        )}

        {/* My items */}
        {myItems.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('cart.myItems')}
            </h2>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4">
              {myItems.map((item) => (
                <CartItem
                  key={item.id}
                  item={item}
                  onIncrement={handleIncrement}
                  onDecrement={handleDecrement}
                  onRemove={removeItem}
                  disabled={isPaying}
                />
              ))}
            </div>
          </section>
        )}

        {/* Shared items */}
        {sharedItems.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('cart.sharedItems')}
            </h2>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4">
              {sharedItems.map((item) => (
                <CartSharedItem key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer — sticky with totals + CTA */}
      {!allEmpty && (
        <footer
          className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-lg px-4 pt-3"
          style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
        >
          <CartTotals
            itemCount={itemCount}
            totalCents={totalCents}
            confirmedTotalCents={confirmedTotalCents}
            hasPendingItems={hasPendingItems}
          />
          <button
            onClick={() => navigate('/cart/confirm')}
            disabled={isPaying || allEmpty}
            className="w-full mt-3 bg-primary text-white font-semibold py-3 rounded-xl hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPaying ? t('cart.blocked.paying.banner') : t('cart.confirm.cta')}
          </button>
        </footer>
      )}
    </AppShell>
  )
}
