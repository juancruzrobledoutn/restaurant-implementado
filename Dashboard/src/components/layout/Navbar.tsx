/**
 * Navbar — minimal top bar.
 *
 * Desktop: empty bar (user info, language toggle, logout moved to Sidebar footer).
 * Mobile: hamburger button to open the sidebar overlay.
 *
 * User actions (language, logout) live in Sidebar footer following the
 * Vercel/Supabase/Linear bottom-sidebar pattern.
 */

import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'
import { BranchSwitcher } from './BranchSwitcher'

interface NavbarProps {
  onHamburgerClick: () => void
}

export function Navbar({ onHamburgerClick }: NavbarProps) {
  const { t } = useTranslation()

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center border-b border-gray-700 bg-gray-900 px-4">
      {/* Hamburger — mobile only */}
      <button
        type="button"
        onClick={onHamburgerClick}
        className="md:hidden flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
        aria-label={t('layout.navbar.toggleSidebar')}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Branch switcher — centered in navbar */}
      <div className="flex flex-1 items-center justify-center">
        <BranchSwitcher />
      </div>
    </header>
  )
}
