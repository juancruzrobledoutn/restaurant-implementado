/**
 * WaiterLayout — top-level layout for authenticated waiter routes.
 *
 * Responsibilities:
 *   - Mount the idle timeout hook (warning at 25min, logout at 30min)
 *   - Render the Topbar + Outlet for child pages
 *   - Render the IdleWarningModal globally (overlays any page)
 *   - Connect the WebSocket when mounted (post-verify) and disconnect on unmount
 *   - Handle WS lifecycle events: auth fail → logout; max reconnect → offline banner
 *
 * The connection/disconnection is keyed on the in-memory JWT. If the user
 * is not authenticated, the ProtectedRoute wrapping this layout will already
 * have redirected — so we can assume `getAccessToken()` returns non-null.
 */
import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Topbar } from './Topbar'
import { IdleWarningModal } from '@/components/auth/IdleWarningModal'
import { useIdleTimeout } from '@/hooks/useIdleTimeout'
import { useAuthStore, selectLogout, selectIsAuthenticated, getAccessToken } from '@/stores/authStore'
import { waiterWsService } from '@/services/waiterWs'
import { logger } from '@/utils/logger'

export function WaiterLayout() {
  const logout = useAuthStore(selectLogout)
  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const [isMaxReconnect, setIsMaxReconnect] = useState(false)

  const { showWarning, minutesRemaining, resetTimer } = useIdleTimeout({
    onLogout: logout,
  })

  // Connect the WS when authenticated; disconnect on unmount / sign-out
  useEffect(() => {
    if (!isAuthenticated) return
    const token = getAccessToken()
    if (!token) return

    waiterWsService.connect(token, undefined, {
      onAuthFail: () => {
        logger.warn('WaiterLayout: WS auth failed — logging out')
        logout()
      },
      onForbidden: () => {
        logger.warn('WaiterLayout: WS forbidden — logging out')
        logout()
      },
      onMaxReconnect: () => {
        logger.warn('WaiterLayout: WS max reconnect reached — showing offline banner')
        setIsMaxReconnect(true)
      },
    })
    return () => {
      waiterWsService.disconnect()
    }
  }, [isAuthenticated, logout])

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-gray-50">
      {/* Permanent offline banner: shown when WS exhausted all reconnect attempts */}
      {isMaxReconnect && (
        <div
          role="alert"
          className="sticky top-0 z-50 bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white"
        >
          Sin conexión — recargá la página para continuar
        </div>
      )}
      <Topbar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
      <IdleWarningModal
        show={showWarning}
        minutesRemaining={minutesRemaining}
        onStay={resetTimer}
      />
    </div>
  )
}
