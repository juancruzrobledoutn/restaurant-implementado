/**
 * ProfilePage — /profile (C-19 / Task 8.4).
 *
 * Shows customer profile, visit history, and preferences.
 * If not opted-in, shows OptInForm.
 * Redirects to /menu if customer profile is null (anonymous diner).
 *
 * Loads data via customerStore.load() on mount.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useSessionStore, selectToken } from '../stores/sessionStore'
import {
  useCustomerStore,
  selectCustomerProfile,
  selectIsCustomerLoading,
  selectVisitHistory,
  selectPreferences,
  selectOptedIn,
} from '../stores/customerStore'
import { useShallow } from 'zustand/react/shallow'
import { OptInForm } from '../components/billing/OptInForm'

export default function ProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const token = useSessionStore(selectToken)
  const profile = useCustomerStore(selectCustomerProfile)
  const isLoading = useCustomerStore(selectIsCustomerLoading)
  const optedIn = useCustomerStore(selectOptedIn)
  const visitHistory = useCustomerStore(useShallow(selectVisitHistory))
  const preferences = useCustomerStore(useShallow(selectPreferences))
  const load = useCustomerStore((s) => s.load)

  // Load on mount — must be before any early returns (Rules of Hooks)
  useEffect(() => {
    if (token) void load()
  }, [token, load])

  // Guard: require active session
  if (!token) {
    navigate('/scan', { replace: true })
    return null
  }

  // Redirect if no profile (anonymous diner) and not loading
  if (!isLoading && profile === null) {
    navigate('/menu', { replace: true })
    return null
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-orange-500 text-lg">{t('common.loading')}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col overflow-x-hidden w-full max-w-full">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 text-gray-600 hover:text-gray-800"
          aria-label={t('common.back')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-gray-800">{t('customer.profile.title')}</h1>
      </header>

      <main className="flex-1 flex flex-col gap-6 p-4">
        {/* Profile info */}
        {profile && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            {profile.name && (
              <p className="text-base font-semibold text-gray-800">{profile.name}</p>
            )}
            {profile.email && (
              <p className="text-sm text-gray-500">{profile.email}</p>
            )}
            {profile.deviceHint && (
              <p className="text-xs text-gray-400 mt-1">ID: {profile.deviceHint}...</p>
            )}
          </div>
        )}

        {/* Opt-in form (shown when not yet opted in) */}
        {!optedIn && (
          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-base font-semibold text-gray-800 mb-1">
              {t('customer.optin.title')}
            </h2>
            <p className="text-sm text-gray-500 mb-4">{t('customer.optin.subtitle')}</p>
            <OptInForm onSuccess={() => void load()} />
          </section>
        )}

        {/* Visit history */}
        <section>
          <h2 className="text-base font-semibold text-gray-800 mb-3">
            {t('customer.profile.history')}
          </h2>
          {visitHistory.length === 0 ? (
            <p className="text-sm text-gray-500">{t('customer.profile.historyEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visitHistory.map((visit) => (
                <li
                  key={visit.sessionId}
                  className="bg-white rounded-lg border border-gray-200 px-4 py-3"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-700 capitalize">{visit.status.toLowerCase()}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(visit.visitedAt).toLocaleDateString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Top preferences */}
        {optedIn && (
          <section>
            <h2 className="text-base font-semibold text-gray-800 mb-3">
              {t('customer.profile.preferences')}
            </h2>
            {preferences.length === 0 ? (
              <p className="text-sm text-gray-500">{t('customer.profile.preferencesEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {preferences.map((pref) => (
                  <li
                    key={pref.productId}
                    className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex justify-between items-center"
                  >
                    <span className="text-sm font-medium text-gray-800">{pref.productName}</span>
                    <span className="text-xs text-gray-500">
                      {t('customer.profile.timesOrdered', { count: pref.totalQuantity })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
