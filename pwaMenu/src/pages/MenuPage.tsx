/**
 * MenuPage — displays the public menu for the branch.
 *
 * Protected: requires active session (redirects to /scan otherwise).
 * Fetches GET /api/public/menu/{slug} and renders CategoryList.
 */
import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useRequireSession } from '../hooks/useRequireSession'
import { useSessionStore, selectBranchSlug, selectIsPaying } from '../stores/sessionStore'
import { useCartStore, selectItemCount, selectTotalCents } from '../stores/cartStore'
import { getPublicMenu } from '../services/menu'
import { CategoryList } from '../components/menu/CategoryList'
import { SearchBar } from '../components/menu/SearchBar'
import { AllergenFilter } from '../components/menu/AllergenFilter'
import { AppShell } from '../components/layout/AppShell'
import { formatPrice } from '../utils/price'
import type { Category } from '../types/menu'
import type { AllergenCode } from '../components/menu/AllergenFilter'
import { logger } from '../utils/logger'

const BRANCH_SLUG_FALLBACK = (import.meta.env.VITE_BRANCH_SLUG as string | undefined) ?? 'default'
const EMPTY_CATEGORIES: Category[] = []

export default function MenuPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  useRequireSession()

  const branchSlug = useSessionStore(selectBranchSlug) ?? BRANCH_SLUG_FALLBACK
  const isPaying = useSessionStore(selectIsPaying)
  const cartItemCount = useCartStore(selectItemCount)
  const cartTotalCents = useCartStore(selectTotalCents)

  const [categories, setCategories] = useState<Category[]>(EMPTY_CATEGORIES)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [excludedAllergens, setExcludedAllergens] = useState<Set<AllergenCode>>(new Set())
  const [showFilters, setShowFilters] = useState(false)

  const loadMenu = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true)
      setFetchError(false)
      try {
        const data = await getPublicMenu(branchSlug, signal)
        setCategories(data)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        logger.error('Failed to load menu', err)
        setFetchError(true)
      } finally {
        setLoading(false)
      }
    },
    [branchSlug],
  )

  useEffect(() => {
    const controller = new AbortController()
    void loadMenu(controller.signal)
    return () => controller.abort()
  }, [loadMenu])

  function handleToggleAllergen(code: AllergenCode) {
    setExcludedAllergens((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function handleClearAllergens() {
    setExcludedAllergens(new Set())
  }

  const hasActiveFilters = searchQuery.trim().length > 0 || excludedAllergens.size > 0

  return (
    <AppShell className="bg-gray-50">
      {/* Cart FAB */}
      {cartItemCount > 0 && (
        <button
          data-testid="cart-button"
          onClick={() => !isPaying && navigate('/cart')}
          disabled={isPaying}
          title={isPaying ? t('cart.blocked.paying.tooltip') : undefined}
          aria-label={t('cart.title')}
          className="fixed bottom-6 right-4 z-50 bg-primary text-white rounded-full shadow-lg px-4 py-3 flex items-center gap-2 hover:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all active:scale-95"
          style={{ bottom: 'max(24px, env(safe-area-inset-bottom))' }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <span className="text-sm font-bold">
            {cartItemCount}
          </span>
          <span className="text-sm font-semibold hidden sm:inline">
            {formatPrice(cartTotalCents)}
          </span>
        </button>
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 pt-4 pb-3 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-900">{t('menu.title')}</h1>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
              excludedAllergens.size > 0
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-gray-600 border-gray-300'
            }`}
          >
            {t('menu.filters')}
            {excludedAllergens.size > 0 && ` (${excludedAllergens.size})`}
          </button>
        </div>
        <SearchBar onSearch={setSearchQuery} />
        {showFilters && (
          <div className="mt-3">
            <AllergenFilter
              selected={excludedAllergens}
              onToggle={handleToggleAllergen}
              onClear={handleClearAllergens}
            />
          </div>
        )}
      </header>

      <main className="px-4 py-4">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            <span className="ml-3 text-gray-500">{t('menu.loading')}</span>
          </div>
        )}

        {fetchError && !loading && (
          <div className="text-center py-16 px-6">
            <p className="text-gray-500 mb-4">{t('error.network')}</p>
            <button
              onClick={() => {
                const controller = new AbortController()
                void loadMenu(controller.signal)
              }}
              className="bg-primary text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-dark transition-colors"
            >
              {t('error.tryAgain')}
            </button>
          </div>
        )}

        {!loading && !fetchError && categories.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-500">{t('menu.empty')}</p>
          </div>
        )}

        {!loading && !fetchError && categories.length > 0 && (
          <>
            {hasActiveFilters && (
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-gray-500">{t('menu.filters')}</span>
                <button
                  onClick={() => {
                    setSearchQuery('')
                    handleClearAllergens()
                  }}
                  className="text-sm text-primary hover:underline"
                >
                  {t('menu.clearFilters')}
                </button>
              </div>
            )}
            <CategoryList
              categories={categories}
              searchQuery={searchQuery}
              excludedAllergens={excludedAllergens}
            />
          </>
        )}
      </main>
    </AppShell>
  )
}
