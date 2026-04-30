/**
 * React Router v7 route definitions.
 *
 * Structure:
 * - /login  → LoginPage (public — ProtectedRoute with publicOnly)
 * - /       → MainLayout (protected)
 *   - index → HomePage
 *   - *     → NotFoundPage
 */

import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'

// Lazy-loaded pages — bundle split at route level
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const HomePage = lazy(() => import('@/pages/HomePage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

// Menu management pages — C-15
const CategoriesPage = lazy(() => import('@/pages/Categories'))
const SubcategoriesPage = lazy(() => import('@/pages/Subcategories'))
const ProductsPage = lazy(() => import('@/pages/Products'))
const AllergensPage = lazy(() => import('@/pages/Allergens'))
const IngredientsPage = lazy(() => import('@/pages/Ingredients'))
const RecipesPage = lazy(() => import('@/pages/Recipes'))

// Operations pages — C-16
const SectorsPage = lazy(() => import('@/pages/Sectors'))
const TablesPage = lazy(() => import('@/pages/Tables'))
const StaffPage = lazy(() => import('@/pages/Staff'))
const WaiterAssignmentsPage = lazy(() => import('@/pages/WaiterAssignments'))
const KitchenDisplayPage = lazy(() => import('@/pages/KitchenDisplay'))
const SalesPage = lazy(() => import('@/pages/Sales'))

// Settings — C-28
const SettingsPage = lazy(() => import('@/pages/Settings'))

// Promotions — C-27
const PromotionsPage = lazy(() => import('@/pages/Promotions'))

// Admin orders — C-25
const OrdersPage = lazy(() => import('@/pages/Orders'))

// Admin billing — C-26
const ChecksPage = lazy(() => import('@/pages/Checks'))
const PaymentsPage = lazy(() => import('@/pages/Payments'))

// Lazy-loaded layout
const MainLayout = lazy(() => import('@/components/layout/MainLayout'))

/** Fullscreen spinner shown while a lazy page is loading. */
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<PageLoader />}>{element}</Suspense>
}

export const router = createBrowserRouter([
  // Public routes
  {
    element: <ProtectedRoute publicOnly />,
    children: [
      {
        path: '/login',
        element: withSuspense(<LoginPage />),
      },
    ],
  },
  // Protected routes — wrapped in MainLayout
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: withSuspense(<MainLayout />),
        // Route handle metadata for breadcrumbs
        handle: { breadcrumb: 'layout.breadcrumbs.home' },
        children: [
          {
            index: true,
            element: withSuspense(<HomePage />),
            handle: { breadcrumb: 'layout.breadcrumbs.home' },
          },
          // Menu management routes — C-15
          {
            path: 'categories',
            element: withSuspense(<CategoriesPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.categories' },
          },
          {
            path: 'subcategories',
            element: withSuspense(<SubcategoriesPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.subcategories' },
          },
          {
            path: 'products',
            element: withSuspense(<ProductsPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.products' },
          },
          {
            path: 'allergens',
            element: withSuspense(<AllergensPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.allergens' },
          },
          {
            path: 'ingredients',
            element: withSuspense(<IngredientsPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.ingredients' },
          },
          {
            path: 'recipes',
            element: withSuspense(<RecipesPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.recipes' },
          },
          // Operations routes — C-16
          {
            path: 'sectors',
            element: withSuspense(<SectorsPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.sectors' },
          },
          {
            path: 'tables',
            element: withSuspense(<TablesPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.tables' },
          },
          {
            path: 'staff',
            element: withSuspense(<StaffPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.staff' },
          },
          {
            path: 'waiter-assignments',
            element: withSuspense(<WaiterAssignmentsPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.waiterAssignments' },
          },
          {
            path: 'kitchen-display',
            element: withSuspense(<KitchenDisplayPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.kitchenDisplay' },
          },
          {
            path: 'sales',
            element: withSuspense(<SalesPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.sales' },
          },
          // Promotions — C-27
          {
            path: 'promotions',
            element: withSuspense(<PromotionsPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.promotions' },
          },
          // Admin orders — C-25
          {
            path: 'orders',
            element: withSuspense(<OrdersPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.orders' },
          },
          // Admin billing — C-26 (ADMIN/MANAGER — backend enforces 403 for other roles)
          {
            path: 'checks',
            element: withSuspense(<ChecksPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.checks' },
          },
          {
            path: 'payments',
            element: withSuspense(<PaymentsPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.payments' },
          },
          // Settings — C-28 (all roles — profile tab accessible to all)
          {
            path: 'settings',
            element: withSuspense(<SettingsPage />),
            handle: { breadcrumb: 'layout.breadcrumbs.settings' },
          },
          {
            path: '*',
            element: withSuspense(<NotFoundPage />),
          },
        ],
      },
    ],
  },
])
