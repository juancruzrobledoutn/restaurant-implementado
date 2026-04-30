/**
 * IdleWarningModal — shown when useIdleTimeout fires its warning timer.
 * The user can click "Seguir trabajando" to reset timers, or "Cerrar sesión"
 * to log out immediately.
 */

import { useAuthStore, selectLogout } from '@/stores/authStore'

interface Props {
  show: boolean
  minutesRemaining: number
  onStay: () => void
}

export function IdleWarningModal({ show, minutesRemaining, onStay }: Props) {
  const logout = useAuthStore(selectLogout)

  if (!show) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 id="idle-warning-title" className="text-lg font-semibold text-gray-900">
          Tu sesión está por expirar
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          Por inactividad vas a ser desconectado en{' '}
          <strong>
            {minutesRemaining} {minutesRemaining === 1 ? 'minuto' : 'minutos'}
          </strong>
          . ¿Querés seguir trabajando?
        </p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onStay}
            className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            Seguir trabajando
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}
