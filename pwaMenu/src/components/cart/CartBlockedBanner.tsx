/**
 * CartBlockedBanner — orange banner shown when tableStatus === 'PAYING'.
 * Informs the diner that no new orders can be added.
 */
import { useTranslation } from 'react-i18next'

export function CartBlockedBanner() {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
        <svg
          className="w-4 h-4 text-orange-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-orange-800 flex-1">
        {t('cart.blocked.paying.banner')}
      </p>
    </div>
  )
}
