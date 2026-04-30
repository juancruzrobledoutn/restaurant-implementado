/**
 * Topbar — persistent header inside the protected (logged-in) tree.
 * Shows the waiter's name, their branch, their assigned sector, and a logout button.
 */

import { useNavigate } from 'react-router-dom'
import { useAuthStore, selectUser, selectLogout, selectAssignedSectorName } from '@/stores/authStore'
import {
  useBranchSelectionStore,
  selectBranchName,
} from '@/stores/branchSelectionStore'

export function Topbar() {
  const navigate = useNavigate()
  const user = useAuthStore(selectUser)
  const logout = useAuthStore(selectLogout)
  const branchName = useBranchSelectionStore(selectBranchName)
  const sectorName = useAuthStore(selectAssignedSectorName)

  const handleLogout = async () => {
    await logout()
    navigate('/select-branch', { replace: true })
  }

  return (
    <header className="sticky top-0 z-10 w-full border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-gray-900">
            {user?.fullName ?? user?.email ?? 'Mozo'}
          </span>
          <span className="truncate text-xs text-gray-500">
            {branchName ?? 'Sin sucursal'}
            {sectorName ? ` — ${sectorName}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary"
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  )
}
