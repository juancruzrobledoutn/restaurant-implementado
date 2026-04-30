/**
 * HomeQuickLinks — 5 quick-link cards to the main operational pages (C-30).
 *
 * Skills: interface-design, vercel-react-best-practices
 *
 * Responsive grid: 1 col mobile → 2 cols sm → 3 cols lg
 * Icons from lucide-react; routes match the router config.
 */

import { ChefHat, TrendingUp, Grid3x3, Users, ClipboardList } from 'lucide-react'
import { QuickLinkCard } from './QuickLinkCard'

const QUICK_LINKS = [
  {
    to: '/kitchen-display',
    icon: ChefHat,
    title: 'Cocina',
    description: 'Display en tiempo real de tickets y pedidos en cocina',
  },
  {
    to: '/sales',
    icon: TrendingUp,
    title: 'Ventas',
    description: 'KPIs diarios, ingresos y productos mas vendidos',
  },
  {
    to: '/tables',
    icon: Grid3x3,
    title: 'Mesas',
    description: 'Estado de mesas por sector y sesiones activas',
  },
  {
    to: '/staff',
    icon: Users,
    title: 'Personal',
    description: 'Usuarios y roles por sucursal',
  },
  {
    to: '/waiter-assignments',
    icon: ClipboardList,
    title: 'Asignacion de Mozos',
    description: 'Sectores asignados a cada mozo por dia',
  },
] as const

export function HomeQuickLinks() {
  return (
    <section aria-label="Accesos rapidos">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
        Accesos rapidos
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_LINKS.map((link) => (
          <QuickLinkCard
            key={link.to}
            to={link.to}
            icon={link.icon}
            title={link.title}
            description={link.description}
          />
        ))}
      </div>
    </section>
  )
}
