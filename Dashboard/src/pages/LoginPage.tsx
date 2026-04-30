import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore, selectIsAuthenticated, selectError, selectRequires2fa, selectLogin, selectClearError } from '@/stores/authStore'
import { LoginForm } from '@/components/auth/LoginForm'

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const isAuthenticated = useAuthStore(selectIsAuthenticated)
  const error = useAuthStore(selectError)
  const requires2fa = useAuthStore(selectRequires2fa)
  const login = useAuthStore(selectLogin)
  const clearError = useAuthStore(selectClearError)

  // Redirect to home when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, navigate])

  const handleSubmit = useCallback(
    async (email: string, password: string, totpCode?: string) => {
      clearError()
      await login(email, password, totpCode)
    },
    [clearError, login]
  )

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary">Integrador</h1>
          <p className="text-gray-500 mt-1 text-sm">{t('auth.login.subtitle')}</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">
            {t('auth.login.title')}
          </h2>

          {/* Error alert — store-level errors (401, 429, network) */}
          {error && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm"
            >
              {error}
            </div>
          )}

          <LoginForm
            onSubmit={handleSubmit}
            requires2fa={requires2fa}
          />
        </div>
      </div>
    </div>
  )
}
