import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'

export default function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <AppShell className="flex items-center justify-center bg-gray-50">
      <div className="text-center px-6">
        <p className="text-6xl mb-4">404</p>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{t('error.notFound')}</h1>
        <p className="text-gray-500 mb-6">{t('error.notFoundMessage')}</p>
        <Link
          to="/scan"
          className="inline-block bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors"
        >
          {t('error.goToScan')}
        </Link>
      </div>
    </AppShell>
  )
}
