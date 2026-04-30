/**
 * RoundsPage — /rounds
 * Lists all rounds for the current session.
 * Filter to hide canceled rounds (default: hidden).
 * Fetches on mount from GET /api/diner/rounds.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useRequireSession } from '../hooks/useRequireSession'
import { useRoundsStore, selectRounds } from '../stores/roundsStore'
import { roundsApi } from '../services/dinerApi'
import { RoundCard } from '../components/rounds/RoundCard'
import { AppShell } from '../components/layout/AppShell'
import { logger } from '../utils/logger'

export default function RoundsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  useRequireSession()

  const allRounds = useRoundsStore(useShallow(selectRounds))
  const setRounds = useRoundsStore((s) => s.setRounds)

  const [showCanceled, setShowCanceled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)

    roundsApi
      .list()
      .then((rounds) => {
        if (controller.signal.aborted) return
        setRounds(rounds)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        logger.error('RoundsPage: failed to load rounds', err)
        setError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [setRounds])

  // Filter and sort: newest first
  const visibleRounds = allRounds
    .filter((r) => showCanceled || r.status !== 'CANCELED')
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  const hasCanceled = allRounds.some((r) => r.status === 'CANCELED')

  return (
    <AppShell className="bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 pt-4 pb-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/menu')}
            className="text-gray-500 hover:text-gray-700 transition-colors"
            aria-label={t('common.back')}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-900 flex-1">{t('rounds.title')}</h1>
        </div>
      </header>

      <main className="px-4 py-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        )}

        {error && !loading && (
          <div className="text-center py-16">
            <p className="text-gray-400">{t('error.network')}</p>
          </div>
        )}

        {!loading && !error && visibleRounds.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-lg">{t('rounds.empty')}</p>
          </div>
        )}

        {!loading && !error && visibleRounds.map((round) => (
          <RoundCard key={round.id} round={round} />
        ))}

        {/* Toggle canceled filter */}
        {hasCanceled && !loading && (
          <div className="text-center pt-4 pb-8">
            <button
              onClick={() => setShowCanceled((v) => !v)}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showCanceled ? t('rounds.hideCanceled') : t('rounds.showCanceled')}
            </button>
          </div>
        )}
      </main>
    </AppShell>
  )
}
