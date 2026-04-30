/**
 * React Router v7 route tree for pwaWaiter.
 *
 * Public-only tree (anonymous users):
 *   /select-branch        — SelectBranchPage (step 1 of pre-login)
 *   /login                — LoginPage         (step 2)
 *
 * Protected tree (authenticated waiters with branch assignment):
 *   /                     — redirect to /tables
 *   /tables               — TablesPage
 *   /tables/:tableId      — TableDetailPage (C-21)
 *   /tables/:tableId/quick-order — QuickOrderPage (C-21)
 *   /service-calls        — ServiceCallsPage (C-21)
 *   /access-denied        — AccessDeniedPage (verify-branch-assignment returned false)
 *   *                     — NotFoundPage
 */
import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { WaiterLayout } from '@/components/layout/WaiterLayout'

const SelectBranchPage = lazy(() => import('@/pages/SelectBranchPage'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const TablesPage = lazy(() => import('@/pages/TablesPage'))
const TableDetailPage = lazy(() => import('@/pages/TableDetailPage'))
const QuickOrderPage = lazy(() => import('@/pages/QuickOrderPage'))
const ServiceCallsPage = lazy(() => import('@/pages/ServiceCallsPage'))
const AccessDeniedPage = lazy(() => import('@/pages/AccessDeniedPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<PageLoader />}>{element}</Suspense>
}

export const router = createBrowserRouter([
  // Public-only routes (pre-login)
  {
    element: <ProtectedRoute publicOnly />,
    children: [
      { path: '/select-branch', element: withSuspense(<SelectBranchPage />) },
      { path: '/login', element: withSuspense(<LoginPage />) },
    ],
  },

  // Protected routes (authenticated)
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <WaiterLayout />,
        children: [
          { path: '/', element: <Navigate to="/tables" replace /> },
          { path: '/tables', element: withSuspense(<TablesPage />) },
          { path: '/tables/:tableId', element: withSuspense(<TableDetailPage />) },
          { path: '/tables/:tableId/quick-order', element: withSuspense(<QuickOrderPage />) },
          { path: '/service-calls', element: withSuspense(<ServiceCallsPage />) },
          { path: '/access-denied', element: withSuspense(<AccessDeniedPage />) },
          { path: '*', element: withSuspense(<NotFoundPage />) },
        ],
      },
    ],
  },
])
