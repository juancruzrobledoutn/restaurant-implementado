/**
 * SessionActivatePage — activates the diner session from QR deep link.
 *
 * Flow:
 * 1. Read branchSlug + tableCode from URL params, token from searchParams
 * 2. Call sessionStore.activate(...)
 * 3. Call GET /api/diner/session to validate token with backend
 * 4. On success: update sessionId, replaceState to /menu, navigate('/menu')
 * 5. On 401: clear() + navigate('/scan?reason=expired')
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '../stores/sessionStore'
import { getDinerSession } from '../services/session'
import { AppShell } from '../components/layout/AppShell'
import { ApiError } from '../services/api'
import { logger } from '../utils/logger'

export default function SessionActivatePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { branchSlug, tableCode } = useParams<{ branchSlug: string; tableCode: string }>()
  const [searchParams] = useSearchParams()

  const activate = useSessionStore((s) => s.activate)
  const setSessionId = useSessionStore((s) => s.setSessionId)
  const clear = useSessionStore((s) => s.clear)

  const [error, setError] = useState(false)

  useEffect(() => {
    const token = searchParams.get('token')

    if (!branchSlug || !tableCode || !token) {
      void navigate('/scan', { replace: true })
      return
    }

    // Immediately remove the token from the URL to avoid it staying in history
    history.replaceState(null, '', '/menu')

    activate({ token, branchSlug, tableCode })

    const controller = new AbortController()

    async function doActivate() {
      try {
        const session = await getDinerSession(controller.signal)
        setSessionId(session.id)
        logger.info('Session activated with backend session id', session.id)
        void navigate('/menu', { replace: true })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        if (err instanceof ApiError && err.status === 401) {
          clear()
          void navigate('/scan?reason=expired', { replace: true })
          return
        }
        logger.error('Session activation failed', err)
        setError(true)
      }
    }

    void doActivate()

    return () => {
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AppShell className="flex items-center justify-center bg-gray-50">
      <div className="text-center px-6">
        {error ? (
          <>
            <p className="text-4xl mb-4">!</p>
            <p className="text-gray-700 mb-4">{t('session.error')}</p>
            <button
              onClick={() => void navigate('/scan', { replace: true })}
              className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors"
            >
              {t('error.goToScan')}
            </button>
          </>
        ) : (
          <>
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-600">{t('session.activating')}</p>
          </>
        )}
      </div>
    </AppShell>
  )
}
