/**
 * SelectBranchPage — first step of the waiter pre-login flow.
 *
 * Fetches `GET /api/public/branches` (no auth) and lets the waiter pick their
 * branch for today. The selection is persisted to localStorage via
 * branchSelectionStore so the next app open remembers it.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPublicBranches } from '@/services/waiter'
import {
  useBranchSelectionStore,
  selectSelectBranchAction,
} from '@/stores/branchSelectionStore'
import { handleError, logger } from '@/utils/logger'
import type { Branch } from '@/types/branch'

type Status = 'loading' | 'ready' | 'error' | 'empty'

export default function SelectBranchPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('loading')
  const [branches, setBranches] = useState<Branch[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const selectBranch = useBranchSelectionStore(selectSelectBranchAction)

  const load = async () => {
    setStatus('loading')
    setErrorMessage(null)
    try {
      const list = await getPublicBranches()
      if (list.length === 0) {
        setStatus('empty')
        setBranches([])
        return
      }
      setBranches(list)
      setStatus('ready')
    } catch (err) {
      const message = handleError(err, 'SelectBranchPage.load')
      setErrorMessage(message)
      setStatus('error')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handlePick = (branch: Branch) => {
    selectBranch({
      branchId: branch.id,
      branchName: branch.name,
      branchSlug: branch.slug,
    })
    logger.info('SelectBranchPage: branch picked', { branchId: branch.id })
    navigate('/login', { replace: true })
  }

  return (
    <main className="min-h-screen w-full max-w-full overflow-x-hidden bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-md">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Buen Sabor</h1>
          <p className="mt-1 text-sm text-gray-600">Seleccioná tu sucursal</p>
        </header>

        {status === 'loading' && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center py-12"
          >
            <span className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">No pudimos cargar las sucursales.</p>
            {errorMessage ? <p className="mt-1 text-xs">{errorMessage}</p> : null}
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Reintentar
            </button>
          </div>
        )}

        {status === 'empty' && (
          <div className="rounded-md border border-gray-300 bg-white p-6 text-center text-sm text-gray-600">
            No hay sucursales activas.
          </div>
        )}

        {status === 'ready' && (
          <ul className="space-y-3">
            {branches.map((branch) => (
              <li key={branch.id}>
                <button
                  type="button"
                  onClick={() => handlePick(branch)}
                  className="flex w-full flex-col items-start rounded-lg border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-primary hover:shadow focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <span className="text-base font-semibold text-gray-900">
                    {branch.name}
                  </span>
                  <span className="mt-1 text-xs text-gray-500">{branch.address}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
