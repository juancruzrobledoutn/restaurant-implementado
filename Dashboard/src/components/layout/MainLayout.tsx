/**
 * MainLayout — composes Sidebar + Navbar + Breadcrumbs + Outlet.
 * Only rendered for authenticated routes.
 *
 * Sidebar state:
 * - Desktop: persistent collapse stored in localStorage
 * - Mobile: overlay toggled by hamburger button in Navbar
 */

import { useState, useEffect } from 'react'
import { Outlet } from 'react-router'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'
import { Breadcrumbs } from './Breadcrumbs'
import { IdleWarningModal } from '@/components/auth/IdleWarningModal'
import { ToastContainer } from '@/components/ui/ToastContainer'
import { useIdleTimeout } from '@/hooks/useIdleTimeout'
import { useMenuWebSocketSync } from '@/hooks/useMenuWebSocketSync'
import { useAuthStore, selectLogout, selectUser } from '@/stores/authStore'
import { useBranchStore, selectFetchBranches } from '@/stores/branchStore'
import { STORAGE_KEYS } from '@/utils/constants'

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === 'true'
  } catch {
    return false
  }
}

export default function MainLayout() {
  const [isCollapsed, setIsCollapsed] = useState(getInitialCollapsed)
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  const logout = useAuthStore(selectLogout)
  const user = useAuthStore(selectUser)
  const fetchBranches = useBranchStore(selectFetchBranches)

  // Mount the WS sync hook — routes all menu WS events to stores
  useMenuWebSocketSync()

  // Fetch branches on mount (post-login) — user.branchIds are strings in frontend
  useEffect(() => {
    if (user?.branchIds && user.branchIds.length > 0) {
      const numericIds = user.branchIds.map((id) => parseInt(id, 10))
      void fetchBranches(numericIds)
    }
  }, [user?.branchIds, fetchBranches])

  const { showWarning, minutesRemaining, resetTimer } = useIdleTimeout({
    onLogout: logout,
  })

  function handleToggleCollapse() {
    setIsCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, String(next))
      } catch {
        // localStorage may be blocked
      }
      return next
    })
  }

  // Close mobile sidebar on resize to desktop
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 768) {
        setIsMobileOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-gray-900">
      {/* Sidebar */}
      <Sidebar
        isCollapsed={isCollapsed}
        onToggleCollapse={handleToggleCollapse}
        isOpen={isMobileOpen}
        onClose={() => setIsMobileOpen(false)}
      />

      {/* Main content area */}
      <div
        className={[
          'flex flex-1 flex-col overflow-hidden transition-all duration-300',
          // Offset for sidebar width on desktop
          isCollapsed ? 'md:ml-16' : 'md:ml-64',
        ].join(' ')}
      >
        {/* Top navbar */}
        <Navbar onHamburgerClick={() => setIsMobileOpen(true)} />

        {/* Breadcrumbs */}
        <Breadcrumbs />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-gray-800">
          <Outlet />
        </main>
      </div>

      {/* Idle warning modal */}
      {showWarning && (
        <IdleWarningModal
          minutesRemaining={minutesRemaining}
          onDismiss={resetTimer}
        />
      )}

      {/* Global toast notifications */}
      <ToastContainer />
    </div>
  )
}
