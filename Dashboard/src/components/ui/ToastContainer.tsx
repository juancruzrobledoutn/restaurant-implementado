/**
 * ToastContainer — renders global toast notifications.
 *
 * Mounted once in MainLayout. Never render this in individual pages.
 *
 * Accessibility:
 * - success/info toasts: role="status" + aria-live="polite"
 * - error toasts: role="alert" + aria-live="assertive"
 *
 * Skill: dashboard-crud-page
 */

import { X } from 'lucide-react'
import { useToastStore, selectToasts, type ToastVariant } from '@/stores/toastStore'

const variantClasses: Record<ToastVariant, string> = {
  success: 'bg-green-900/90 border-green-700 text-green-100',
  error: 'bg-red-900/90 border-red-700 text-red-100',
  info: 'bg-gray-800/90 border-gray-600 text-gray-100',
}

export function ToastContainer() {
  const toasts = useToastStore(selectToasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.variant === 'error' ? 'alert' : 'status'}
          aria-live={t.variant === 'error' ? 'assertive' : 'polite'}
          className={[
            'flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm',
            'animate-in slide-in-from-top-2 duration-200',
            variantClasses[t.variant],
          ].join(' ')}
        >
          <p className="flex-1 text-sm">{t.message}</p>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Cerrar notificación"
            className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 transition-opacity"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
