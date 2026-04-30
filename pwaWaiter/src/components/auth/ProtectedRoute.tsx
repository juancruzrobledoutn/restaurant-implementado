/**
 * ProtectedRoute — controls access to the router's protected/public-only trees.
 *
 * Public-only tree (login, select-branch): authenticated users are redirected
 * to /tables.
 *
 * Protected tree:
 *   - Unauthenticated + no branch selected → /select-branch
 *   - Unauthenticated + branch selected    → /login
 *   - Authenticated                        → allowed
 *
 * Usage in router:
 *   { element: <ProtectedRoute publicOnly />, children: [...] }  // login, select-branch
 *   { element: <ProtectedRoute />,            children: [...] }  // tables, access-denied
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore, selectIsAuthenticated } from '@/stores/authStore'
import {
  useBranchSelectionStore,
  selectHasBranchSelection,
} from '@/stores/branchSelectionStore'

interface ProtectedRouteProps {
  publicOnly?: boolean
}

export function ProtectedRoute({ publicOnly = false }: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const hasBranch = useBranchSelectionStore(selectHasBranchSelection)
  const location = useLocation()

  if (publicOnly) {
    if (isAuthenticated) {
      return <Navigate to="/tables" replace />
    }
    return <Outlet />
  }

  // Protected tree
  if (!isAuthenticated) {
    if (!hasBranch) {
      return <Navigate to="/select-branch" replace state={{ from: location }} />
    }
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
