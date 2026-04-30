/**
 * Application router.
 *
 * All pages are lazy-loaded for optimal bundle splitting.
 * The root route redirects based on session state.
 */
import { createBrowserRouter, redirect } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { useSessionStore } from './stores/sessionStore'

const ScannerPage = lazy(() => import('./pages/ScannerPage'))
const SessionActivatePage = lazy(() => import('./pages/SessionActivatePage'))
const MenuPage = lazy(() => import('./pages/MenuPage'))
const CartPage = lazy(() => import('./pages/CartPage'))
const CartConfirmPage = lazy(() => import('./pages/CartConfirmPage'))
const RoundsPage = lazy(() => import('./pages/RoundsPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

// C-19: billing + customer loyalty pages
const CheckRequestPage = lazy(() => import('./pages/CheckRequestPage'))
const CheckStatusPage = lazy(() => import('./pages/CheckStatusPage'))
const PaymentResultPage = lazy(() => import('./pages/PaymentResultPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center overflow-x-hidden w-full max-w-full">
      <div className="animate-pulse text-primary text-lg">...</div>
    </div>
  )
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<PageLoader />}>{element}</Suspense>
}

export const router = createBrowserRouter([
  {
    path: '/',
    loader: () => {
      const state = useSessionStore.getState()
      if (state.token && !state.isExpired()) {
        return redirect('/menu')
      }
      return redirect('/scan')
    },
  },
  {
    path: '/scan',
    element: withSuspense(<ScannerPage />),
  },
  {
    path: '/t/:branchSlug/:tableCode',
    element: withSuspense(<SessionActivatePage />),
  },
  {
    path: '/menu',
    element: withSuspense(<MenuPage />),
  },
  {
    path: '/cart',
    element: withSuspense(<CartPage />),
  },
  {
    path: '/cart/confirm',
    element: withSuspense(<CartConfirmPage />),
  },
  {
    path: '/rounds',
    element: withSuspense(<RoundsPage />),
  },
  // C-19: billing + customer loyalty routes
  {
    path: '/check/request',
    element: withSuspense(<CheckRequestPage />),
  },
  {
    path: '/check',
    element: withSuspense(<CheckStatusPage />),
  },
  {
    path: '/payment/result',
    element: withSuspense(<PaymentResultPage />),
  },
  {
    path: '/profile',
    element: withSuspense(<ProfilePage />),
  },
  {
    path: '*',
    element: withSuspense(<NotFoundPage />),
  },
])
