/**
 * AccessDeniedPage — shown when verify-branch-assignment returns assigned=false.
 *
 * The waiter is authenticated but NOT assigned to the selected branch today.
 * Two paths out:
 *   - "Cerrar sesión" → logout + clear selection → /select-branch
 *   - "Cambiar sucursal" → keep auth, clear selection/assignment → /select-branch
 *     (the waiter can then pick a different branch and re-verify)
 */
import { useNavigate } from 'react-router-dom'
import {
  useAuthStore,
  selectLogout,
  selectClearAssignment,
} from '@/stores/authStore'
import {
  useBranchSelectionStore,
  selectBranchName,
  selectClearBranchSelectionAction,
} from '@/stores/branchSelectionStore'

export default function AccessDeniedPage() {
  const navigate = useNavigate()
  const branchName = useBranchSelectionStore(selectBranchName)
  const clearSelection = useBranchSelectionStore(selectClearBranchSelectionAction)
  const logout = useAuthStore(selectLogout)
  const clearAssignment = useAuthStore(selectClearAssignment)

  const handleLogout = async () => {
    clearSelection()
    await logout()
    navigate('/select-branch', { replace: true })
  }

  const handleChangeBranch = () => {
    clearAssignment()
    clearSelection()
    navigate('/select-branch', { replace: true })
  }

  return (
    <section className="mx-auto max-w-md rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-gray-900">Acceso denegado</h1>
      <p className="mt-3 text-sm text-gray-700">
        No estás asignado a <strong>{branchName ?? 'esta sucursal'}</strong> para
        el día de hoy. Si esto es un error, pedile al administrador que te asigne
        a un sector.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary"
        >
          Cerrar sesión
        </button>
        <button
          type="button"
          onClick={handleChangeBranch}
          className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          Cambiar sucursal
        </button>
      </div>
    </section>
  )
}
