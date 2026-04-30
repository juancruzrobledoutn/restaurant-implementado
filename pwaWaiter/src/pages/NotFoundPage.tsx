/**
 * NotFoundPage — catch-all 404 inside the authenticated tree.
 */
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <section className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-3xl font-bold text-gray-900">404</h1>
      <p className="mt-2 text-sm text-gray-600">Página no encontrada.</p>
      <Link
        to="/tables"
        className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
      >
        Volver a las mesas
      </Link>
    </section>
  )
}
