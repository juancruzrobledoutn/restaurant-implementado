/**
 * CartConfirmPage — /cart/confirm
 * Shows grouped summary by diner, optional notes, submit CTA.
 * Handles 409 session_paying (toast + redirect) and 409 insufficient_stock (inline panel).
 *
 * Submit uses React 19 useActionState pattern:
 * - `isPending` from useActionState drives the disabled state (no manual isSubmitting)
 * - `formAction` is passed to <form action={formAction}>
 * - Notes are read from FormData inside the action
 */
import { useActionState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useRequireSession } from '../hooks/useRequireSession'
import { useSessionStatusGuard } from '../hooks/useSessionStatusGuard'
import { useSessionStore, selectIsPaying } from '../stores/sessionStore'
import { useCartStore, selectItems, selectTotalCents } from '../stores/cartStore'
import { useRoundsStore } from '../stores/roundsStore'
import { roundsApi, CartConflictError } from '../services/dinerApi'
import type { InsufficientStockProduct } from '../services/dinerApi'
import { DinerAvatar } from '../components/cart/DinerAvatar'
import { CartBlockedBanner } from '../components/cart/CartBlockedBanner'
import { AppShell } from '../components/layout/AppShell'
import { formatCartItemSubtotal, formatPrice } from '../utils/price'
import { logger } from '../utils/logger'
import type { CartItem } from '../types/cart'

/** Action state returned by the submit action */
interface SubmitActionState {
  stockError: InsufficientStockProduct[] | null
  error: string | null
}

const INITIAL_SUBMIT_STATE: SubmitActionState = {
  stockError: null,
  error: null,
}

export default function CartConfirmPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  useRequireSession()
  useSessionStatusGuard()

  const isPaying = useSessionStore(selectIsPaying)
  const items = useCartStore(useShallow(selectItems))
  const totalCents = useCartStore(selectTotalCents)
  const upsertRound = useRoundsStore((s) => s.upsertRound)
  const clearCart = useCartStore((s) => s.clear)

  // Group items by diner
  const byDiner = items.reduce<Record<string, CartItem[]>>((acc, item) => {
    if (!acc[item.dinerId]) acc[item.dinerId] = []
    acc[item.dinerId].push(item)
    return acc
  }, {})

  const submitAction = useCallback(
    async (
      _prevState: SubmitActionState,
      formData: FormData,
    ): Promise<SubmitActionState> => {
      if (isPaying || items.length === 0) return INITIAL_SUBMIT_STATE

      const notes = (formData.get('notes') as string | null)?.trim() || undefined

      try {
        const round = await roundsApi.submit(notes)
        upsertRound(round)
        clearCart()
        navigate('/rounds')
        return INITIAL_SUBMIT_STATE
      } catch (err) {
        if (err instanceof CartConflictError) {
          if (err.detail.reason === 'session_paying') {
            useSessionStore.getState().setTableStatus('PAYING')
            navigate('/menu')
            return INITIAL_SUBMIT_STATE
          } else if (err.detail.reason === 'insufficient_stock') {
            return { stockError: err.detail.products, error: null }
          }
        }
        logger.error('CartConfirmPage: submit failed', err)
        return { stockError: null, error: 'unknown' }
      }
    },
    [isPaying, items.length, upsertRound, clearCart, navigate],
  )

  const [state, formAction, isPending] = useActionState<SubmitActionState, FormData>(
    submitAction,
    INITIAL_SUBMIT_STATE,
  )

  const isEmpty = items.length === 0

  return (
    <AppShell className="bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 pt-4 pb-3 shadow-sm">
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
          <h1 className="text-xl font-bold text-gray-900 flex-1">{t('cart.confirm.title')}</h1>
        </div>
      </header>

      <form id="cart-confirm-form" action={formAction}>
        <main className="px-4 py-4 pb-36 space-y-4">
          {/* Paying banner */}
          {isPaying && <CartBlockedBanner />}

          {/* Insufficient stock panel */}
          {state.stockError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <h3 className="text-sm font-semibold text-red-800 mb-2">
                {t('errors.cart.insufficient_stock')}
              </h3>
              <ul className="space-y-1">
                {state.stockError.map((p) => (
                  <li key={p.product_id} className="text-xs text-red-700">
                    {p.name}: {t('cart.confirm.stockAvailable', { available: p.available, requested: p.requested })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isEmpty ? (
            <div className="text-center py-16">
              <p className="text-gray-400 text-lg">{t('cart.empty')}</p>
            </div>
          ) : (
            <>
              {/* Summary grouped by diner */}
              {Object.entries(byDiner).map(([dinerId, dinerItems]) => {
                const dinerName = dinerItems[0].dinerName
                const dinerTotal = dinerItems.reduce(
                  (acc, item) => acc + item.priceCentsSnapshot * item.quantity,
                  0,
                )

                return (
                  <section key={dinerId} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    {/* Diner header */}
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
                      <DinerAvatar dinerId={dinerId} dinerName={dinerName} size="md" />
                      <span className="text-sm font-semibold text-gray-700">{dinerName}</span>
                      <span className="ml-auto text-sm font-bold text-primary">
                        {formatPrice(dinerTotal)}
                      </span>
                    </div>

                    {/* Items */}
                    <div className="px-4 divide-y divide-gray-50">
                      {dinerItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between py-2.5 text-sm">
                          <span className="text-gray-700 flex-1 truncate">{item.productName}</span>
                          <span className="text-gray-500 mx-3">×{item.quantity}</span>
                          <span className="font-medium text-gray-800">
                            {formatCartItemSubtotal(item.priceCentsSnapshot, item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )
              })}

              {/* Notes */}
              <section className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('cart.confirm.notes_label')}
                  <span className="text-gray-400 font-normal ml-1">({t('common.optional')})</span>
                </label>
                <textarea
                  name="notes"
                  placeholder={t('cart.confirm.notes_placeholder')}
                  maxLength={300}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </section>
            </>
          )}
        </main>

        {/* Submit footer */}
        {!isEmpty && (
          <footer
            className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-lg px-4 pt-3"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">{t('cart.total')}</span>
              <span className="text-lg font-bold text-primary">{formatPrice(totalCents)}</span>
            </div>

            {!isPaying ? (
              <button
                type="submit"
                form="cart-confirm-form"
                disabled={isPending || isEmpty}
                className="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isPending && (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {t('cart.confirm.submit')}
              </button>
            ) : (
              <div className="text-center py-2">
                <p className="text-sm text-orange-700 font-medium">{t('cart.blocked.paying.banner')}</p>
              </div>
            )}
          </footer>
        )}
      </form>
    </AppShell>
  )
}
