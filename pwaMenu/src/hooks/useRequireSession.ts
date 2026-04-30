/**
 * Guard hook for protected routes.
 * Redirects to /scan if there is no valid session.
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from '../stores/sessionStore'

export function useRequireSession(): void {
  const navigate = useNavigate()
  const isExpired = useSessionStore((s) => s.isExpired)
  const token = useSessionStore((s) => s.token)

  useEffect(() => {
    if (!token || isExpired()) {
      void navigate('/scan', { replace: true })
    }
  }, [token, isExpired, navigate])
}
