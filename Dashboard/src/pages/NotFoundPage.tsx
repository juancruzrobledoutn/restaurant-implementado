import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Home } from 'lucide-react'

export default function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md px-4">
        <p className="text-8xl font-bold text-primary mb-4">404</p>
        <h1 className="text-2xl font-semibold text-gray-900 mb-3">
          {t('pages.notFound.title')}
        </h1>
        <p className="text-gray-500 mb-8">
          {t('pages.notFound.message')}
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors font-medium"
        >
          <Home className="h-4 w-4" />
          {t('pages.notFound.backHome')}
        </Link>
      </div>
    </div>
  )
}
