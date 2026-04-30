/**
 * ProtectedRoute — redirects unauthenticated users to /login.
 * Authenticated users accessing /login are redirected to /.
 *
 * Usage in router:
 *   { path: '/', element: <ProtectedRoute />, children: [...] }
 *   { path: '/login', element: <ProtectedRoute publicOnly />, children: [...] }
 */

import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuthStore, selectIsAuthenticated } from '@/stores/authStore'

interface ProtectedRouteProps {
  /** If true, only unauthenticated users can access this route (login page). */
  publicOnly?: boolean
}

export function ProtectedRoute({ publicOnly = false }: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const location = useLocation()

  if (publicOnly) {
    // Login page: redirect authenticated users away
    if (isAuthenticated) {
      return <Navigate to="/" replace />
    }
    return <Outlet />
  }

  // Protected routes: redirect unauthenticated users to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
