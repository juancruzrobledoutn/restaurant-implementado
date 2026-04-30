/**
 * IdleWarningModal — shown when the user has been idle for 25 minutes.
 * Dismissable by clicking "Stay logged in" or by any user activity (handled by parent).
 */

import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'

interface IdleWarningModalProps {
  minutesRemaining: number
  onDismiss: () => void
}

export function IdleWarningModal({ minutesRemaining, onDismiss }: IdleWarningModalProps) {
  const { t } = useTranslation()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onDismiss} aria-hidden="true" />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <h2 id="idle-warning-title" className="text-base font-semibold text-gray-900">
            {t('idle.warningTitle')}
          </h2>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          {t('idle.warningMessage', { minutes: minutesRemaining })}
        </p>

        <button
          type="button"
          onClick={onDismiss}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors"
          autoFocus
        >
          {t('idle.stayLoggedIn')}
        </button>
      </div>
    </div>
  )
}
