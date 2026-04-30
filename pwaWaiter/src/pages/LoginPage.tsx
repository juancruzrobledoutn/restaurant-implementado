/**
 * LoginPage — step 2 of the waiter pre-login flow.
 *
 * Requires a branch to be selected (otherwise redirects to /select-branch).
 * On successful authentication, runs usePostLoginVerify; navigates to
 * /tables (assigned) or /access-denied (not assigned) based on the result.
 */
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  useAuthStore,
  selectIsAuthenticated,
  selectIsLoading,
  selectError,
  selectRequires2fa,
  selectLogin,
  selectClearError,
} from '@/stores/authStore'
import {
  useBranchSelectionStore,
  selectBranchId,
  selectBranchName,
  selectHasBranchSelection,
  selectClearBranchSelectionAction,
} from '@/stores/branchSelectionStore'
import { usePostLoginVerify } from '@/hooks/usePostLoginVerify'

export default function LoginPage() {
  const navigate = useNavigate()
  const hasBranch = useBranchSelectionStore(selectHasBranchSelection)
  const branchId = useBranchSelectionStore(selectBranchId)
  const branchName = useBranchSelectionStore(selectBranchName)
  const clearSelection = useBranchSelectionStore(selectClearBranchSelectionAction)

  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const isLoading = useAuthStore(selectIsLoading)
  const error = useAuthStore(selectError)
  const requires2fa = useAuthStore(selectRequires2fa)
  const login = useAuthStore(selectLogin)
  const clearError = useAuthStore(selectClearError)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const verify = usePostLoginVerify(branchId, isAuthenticated)

  useEffect(() => {
    if (verify.status === 'assigned') {
      navigate('/tables', { replace: true })
    } else if (verify.status === 'denied') {
      navigate('/access-denied', { replace: true })
    }
  }, [verify.status, navigate])

  // Guard: redirect to select-branch if no branch is selected
  if (!hasBranch) {
    return <Navigate to="/select-branch" replace />
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void login(email, password)
  }

  const handleChangeBranch = () => {
    clearSelection()
    clearError()
    navigate('/select-branch', { replace: true })
  }

  const isVerifying = verify.status === 'verifying'
  const isBusy = isLoading || isVerifying

  return (
    <main className="min-h-screen w-full max-w-full overflow-x-hidden bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-md">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-gray-600">
            Sucursal: <strong>{branchName}</strong>
          </p>
          <button
            type="button"
            onClick={handleChangeBranch}
            className="mt-2 text-xs font-medium text-primary underline hover:text-primary-dark"
          >
            Cambiar sucursal
          </button>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg bg-white p-6 shadow-sm"
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isBusy}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700"
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isBusy}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100"
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </div>
          ) : null}

          {requires2fa ? (
            <div
              role="alert"
              className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800"
            >
              Tu cuenta tiene 2FA activo. pwaWaiter todavía no soporta 2FA —
              contactá al administrador para deshabilitarlo.
            </div>
          ) : null}

          {verify.status === 'error' ? (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            >
              No pudimos verificar tu asignación. {verify.error}
              <button
                type="button"
                onClick={verify.retry}
                className="ml-2 font-medium underline"
              >
                Reintentar
              </button>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isBusy}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-60"
          >
            {isBusy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </main>
  )
}
