/**
 * Sidebar — collapsible navigation sidebar.
 *
 * Layout (top → bottom):
 *   Brand header
 *   Nav items (scrollable)
 *   Footer:
 *     - User block (avatar initials + name + role)
 *     - Action row (language toggle | logout)
 *     - Collapse toggle (desktop only)
 *
 * Collapsed state: everything folds to icon-only with tooltip titles.
 * Mobile overlay: full sidebar visible when isOpen=true.
 */

import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import {
  Home,
  Tag,
  Layers,
  ShoppingBag,
  Users,
  Grid3X3,
  ChefHat,
  ClipboardList,
  Receipt,
  CreditCard,
  Percent,
  AlertTriangle,
  FlaskConical,
  Salad,
  Settings,
  ChevronLeft,
  ChevronRight,
  Globe,
  LogOut,
  LayoutGrid,
  BarChart2,
  CalendarClock,
} from 'lucide-react'
import { useAuthStore, selectUser, selectLogout, selectIsLoggingOut } from '@/stores/authStore'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'
import { logger } from '@/utils/logger'

interface NavItem {
  path: string
  icon: React.ComponentType<{ className?: string }>
  labelKey: string
  disabled?: boolean
}

interface NavSection {
  labelKey?: string  // section header label (undefined = no header)
  items: NavItem[]
}

// Base nav sections — promotion entry is injected dynamically based on permissions
const BASE_MENU_ITEMS: NavItem[] = [
  { path: '/categories', icon: Tag, labelKey: 'layout.sidebar.categories' },
  { path: '/subcategories', icon: Layers, labelKey: 'layout.sidebar.subcategories' },
  { path: '/products', icon: ShoppingBag, labelKey: 'layout.sidebar.products' },
  { path: '/allergens', icon: AlertTriangle, labelKey: 'layout.sidebar.allergens' },
  { path: '/ingredients', icon: FlaskConical, labelKey: 'layout.sidebar.ingredients' },
  { path: '/recipes', icon: Salad, labelKey: 'layout.sidebar.recipes' },
]

const PROMOTION_ITEM: NavItem = {
  path: '/promotions',
  icon: Percent,
  labelKey: 'layout.sidebar.promotions',
}

const OPERATIONS_ITEMS: NavItem[] = [
  { path: '/sectors', icon: LayoutGrid, labelKey: 'layout.sidebar.sectors' },
  { path: '/tables', icon: Grid3X3, labelKey: 'layout.sidebar.tables' },
  { path: '/staff', icon: Users, labelKey: 'layout.sidebar.staff' },
  { path: '/waiter-assignments', icon: CalendarClock, labelKey: 'layout.sidebar.waiterAssignments' },
  { path: '/kitchen-display', icon: ChefHat, labelKey: 'layout.sidebar.kitchenDisplay' },
  { path: '/sales', icon: BarChart2, labelKey: 'layout.sidebar.sales' },
  { path: '/orders', icon: ClipboardList, labelKey: 'layout.sidebar.orders' },
]

// C-26: billing items — visible to ADMIN/MANAGER only
const BILLING_ITEMS: NavItem[] = [
  { path: '/checks', icon: Receipt, labelKey: 'layout.sidebar.checks' },
  { path: '/payments', icon: CreditCard, labelKey: 'layout.sidebar.payments' },
]

// C-28: Settings is always visible (all roles have access to the Profile tab)
const SETTINGS_ITEMS: NavItem[] = [
  { path: '/settings', icon: Settings, labelKey: 'layout.sidebar.settings' },
]


interface SidebarProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  isOpen: boolean         // mobile overlay state
  onClose: () => void     // close mobile overlay
}

/** Returns up to 2 uppercase initials from a full name. */
function getInitials(fullName: string | undefined): string {
  if (!fullName) return '?'
  const parts = fullName.trim().split(/\s+/)
  return parts
    .slice(0, 2)
    .map((p) => (p[0] ?? '').toUpperCase())
    .join('')
}

export function Sidebar({ isCollapsed, onToggleCollapse, isOpen, onClose }: SidebarProps) {
  const { t, i18n } = useTranslation()
  const location = useLocation()

  // Auth store — named selectors, never destructure
  const user = useAuthStore(selectUser)
  const logout = useAuthStore(selectLogout)
  const isLoggingOut = useAuthStore(selectIsLoggingOut)
  const { canManagePromotions, isAdmin, isManager } = useAuthPermissions()

  const primaryRole = user?.roles[0] ?? ''
  const initials = getInitials(user?.fullName)

  // Build nav sections dynamically based on permissions
  const menuItems = canManagePromotions
    ? [...BASE_MENU_ITEMS, PROMOTION_ITEM]
    : BASE_MENU_ITEMS

  // C-26: billing items visible only to ADMIN/MANAGER (task 10.2)
  const canAccessBilling = isAdmin || isManager
  const operationsItems = canAccessBilling
    ? [...OPERATIONS_ITEMS, ...BILLING_ITEMS]
    : OPERATIONS_ITEMS

  const NAV_SECTIONS: NavSection[] = [
    { items: [{ path: '/', icon: Home, labelKey: 'layout.sidebar.home' }] },
    { labelKey: 'layout.sidebar.menu', items: menuItems },
    { labelKey: 'layout.sidebar.operations', items: operationsItems },
    { items: SETTINGS_ITEMS },
  ]

  function isActive(path: string) {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  async function handleLogout() {
    try {
      await logout()
    } catch (err) {
      logger.error('Sidebar: logout error', err)
    }
  }

  function toggleLanguage() {
    const next = i18n.language === 'es' ? 'en' : 'es'
    i18n.changeLanguage(next)
  }

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-30 flex flex-col bg-gray-900 text-white transition-all duration-300',
          isCollapsed ? 'w-16' : 'w-64',
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        {/* Brand header */}
        <div
          className={[
            'flex items-center border-b border-gray-700',
            isCollapsed ? 'justify-center px-2 h-14' : 'px-4 h-14',
          ].join(' ')}
        >
          {isCollapsed ? (
            <span className="text-lg font-bold text-primary">I</span>
          ) : (
            <span className="text-lg font-bold text-primary tracking-tight">Integrador</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <div className="space-y-4 px-2">
            {NAV_SECTIONS.map((section, sectionIndex) => (
              <div key={sectionIndex}>
                {/* Section header — hidden when collapsed */}
                {section.labelKey && !isCollapsed && (
                  <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {t(section.labelKey, { defaultValue: '' })}
                  </p>
                )}
                <ul className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item.path)
                    const baseClass = [
                      'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                      isCollapsed ? 'justify-center' : '',
                    ].join(' ')
                    return (
                      <li key={item.path}>
                        {item.disabled ? (
                          <span
                            title={isCollapsed ? t(item.labelKey) : undefined}
                            className={`${baseClass} cursor-not-allowed text-gray-600 opacity-50`}
                            aria-disabled="true"
                          >
                            <Icon className="h-5 w-5 shrink-0" />
                            {!isCollapsed && (
                              <span className="truncate">{t(item.labelKey)}</span>
                            )}
                          </span>
                        ) : (
                          <Link
                            to={item.path}
                            onClick={onClose}
                            title={isCollapsed ? t(item.labelKey) : undefined}
                            className={[
                              baseClass,
                              active
                                ? 'bg-primary text-white'
                                : 'text-gray-300 hover:bg-gray-800 hover:text-white',
                            ].join(' ')}
                            aria-current={active ? 'page' : undefined}
                          >
                            <Icon className="h-5 w-5 shrink-0" />
                            {!isCollapsed && (
                              <span className="truncate">{t(item.labelKey)}</span>
                            )}
                          </Link>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {/* Footer — user info + actions + collapse toggle */}
        <div className="border-t border-gray-700">

          {/* User block */}
          <div
            className={[
              'flex items-center gap-3 px-3 py-3',
              isCollapsed ? 'justify-center' : '',
            ].join(' ')}
          >
            {/* Avatar — initials circle */}
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-semibold select-none"
              title={isCollapsed ? user?.fullName : undefined}
              aria-hidden={!isCollapsed}
            >
              {initials}
            </div>

            {!isCollapsed && (
              <div className="flex-1 min-w-0 leading-tight">
                <p className="text-sm font-medium text-white truncate">
                  {user?.fullName}
                </p>
                {primaryRole && (
                  <p className="text-xs text-gray-400 truncate">
                    {t(`auth.role.${primaryRole}`, { defaultValue: primaryRole })}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Action row — language toggle + logout */}
          <div
            className={[
              'flex items-center px-3 pb-3 gap-1',
              isCollapsed ? 'flex-col gap-1' : '',
            ].join(' ')}
          >
            {/* Language toggle */}
            <button
              type="button"
              onClick={toggleLanguage}
              title={t('layout.sidebar.switchLanguage')}
              aria-label={t('layout.sidebar.switchLanguage')}
              className={[
                'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors',
                isCollapsed ? 'justify-center w-full' : 'flex-1',
              ].join(' ')}
            >
              <Globe className="h-4 w-4 shrink-0" />
              {!isCollapsed && (
                <span className="font-medium uppercase text-xs">
                  {i18n.language === 'es' ? 'ES' : 'EN'}
                </span>
              )}
            </button>

            {/* Logout */}
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              title={t('layout.sidebar.logout')}
              aria-label={t('layout.sidebar.logout')}
              className={[
                'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-400 hover:bg-red-900/40 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                isCollapsed ? 'justify-center w-full' : 'flex-1',
              ].join(' ')}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!isCollapsed && (
                <span className="text-sm">{t('layout.sidebar.logout')}</span>
              )}
            </button>
          </div>

          {/* Collapse toggle — desktop only */}
          <div className="hidden md:flex border-t border-gray-700 p-2 justify-end">
            <button
              type="button"
              onClick={onToggleCollapse}
              title={isCollapsed ? t('layout.sidebar.expand') : t('layout.sidebar.collapse')}
              aria-label={isCollapsed ? t('layout.sidebar.expand') : t('layout.sidebar.collapse')}
              className="flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
