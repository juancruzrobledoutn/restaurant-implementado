/**
 * HomeEmptyBranchState — shown on the Home page when no branch is selected.
 *
 * C-30: Uses CustomEvent to coordinate with BranchSwitcher in Navbar
 * without prop drilling or new store state.
 *
 * Skills: interface-design, vercel-react-best-practices
 */

import { Building2 } from 'lucide-react'

export function HomeEmptyBranchState() {
  function handleChooseBranch() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dashboard:focus-branch-switcher'))
    }
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-gray-700 bg-gray-800/50 p-12 text-center">
      <Building2
        className="mb-4 h-14 w-14 text-gray-500"
        aria-hidden="true"
      />
      <h2 className="mb-2 text-xl font-semibold text-white">
        Selecciona una sucursal
      </h2>
      <p className="mb-6 max-w-sm text-sm text-gray-400">
        Para ver el resumen operativo del dia, primero selecciona una sucursal
        desde el selector en la barra superior.
      </p>
      <button
        type="button"
        onClick={handleChooseBranch}
        className="rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-gray-900"
        aria-label="Elegir sucursal"
      >
        Elegir sucursal
      </button>
    </div>
  )
}
