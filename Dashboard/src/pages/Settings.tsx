/**
 * Settings — multi-tab settings page with role-gated tabs.
 *
 * Skills: dashboard-crud-page, react19-form-pattern, api-security-best-practices
 *
 * Tab structure (WAI-ARIA tablist/tab/tabpanel):
 *  - "branch"  — BranchSettingsForm  (ADMIN + MANAGER)
 *  - "profile" — ProfileForm         (all roles)
 *  - "tenant"  — TenantSettingsForm  (ADMIN only)
 *
 * URL sync:
 *  - ?tab=branch|profile|tenant
 *  - Invalid/missing tab → fallback to first visible tab for current role
 *
 * HelpButton per tab (task 14.5).
 *
 * Accessibility:
 *  - role=tablist on the tab bar
 *  - role=tab on each tab button (aria-selected, tabindex)
 *  - role=tabpanel on the content area
 *  - Arrow key navigation (left/right)
 *
 * C-28 task 14.1–14.5
 */

import { useCallback, useId } from 'react'
import { useSearchParams } from 'react-router'
import { PageContainer } from '@/components/ui/PageContainer'
import { HelpButton } from '@/components/ui/HelpButton'
import { BranchSettingsForm } from '@/components/settings/BranchSettingsForm'
import { ProfileForm } from '@/components/settings/ProfileForm'
import { TenantSettingsForm } from '@/components/settings/TenantSettingsForm'
import { useAuthStore, selectUser } from '@/stores/authStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { helpContent } from '@/utils/helpContent'

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = 'branch' | 'profile' | 'tenant'

interface TabDef {
  id: TabId
  label: string
  /** Which roles can see this tab */
  allowedRoles: string[] | 'all'
  helpKey: string
  helpTitle: string
}

const ALL_TABS: TabDef[] = [
  {
    id: 'branch',
    label: 'Sucursal',
    allowedRoles: ['ADMIN', 'MANAGER'],
    helpKey: 'settingsBranch',
    helpTitle: 'Configuracion de Sucursal',
  },
  {
    id: 'profile',
    label: 'Perfil',
    allowedRoles: 'all',
    helpKey: 'settingsProfile',
    helpTitle: 'Perfil y Seguridad',
  },
  {
    id: 'tenant',
    label: 'Negocio',
    allowedRoles: ['ADMIN'],
    helpKey: 'settingsTenant',
    helpTitle: 'Configuracion del Negocio',
  },
]

function isTabAllowed(tab: TabDef, roles: string[]): boolean {
  if (tab.allowedRoles === 'all') return true
  return roles.some((r) => (tab.allowedRoles as string[]).includes(r))
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useAuthStore(selectUser)
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const tabListId = useId()

  const roles = user?.roles ?? []

  // Compute visible tabs for current user's roles
  const visibleTabs = ALL_TABS.filter((t) => isTabAllowed(t, roles))

  // Derive active tab from URL, falling back to first visible tab
  const requestedTab = searchParams.get('tab') as TabId | null
  const isRequestedVisible = requestedTab
    ? visibleTabs.some((t) => t.id === requestedTab)
    : false
  const activeTab: TabId = isRequestedVisible
    ? requestedTab!
    : (visibleTabs[0]?.id ?? 'profile')

  const setActiveTab = useCallback(
    (tabId: TabId) => {
      setSearchParams({ tab: tabId }, { replace: true })
    },
    [setSearchParams],
  )

  // Arrow key navigation
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentIdx: number) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        const next = (currentIdx + 1) % visibleTabs.length
        setActiveTab(visibleTabs[next]!.id)
        ;(document.getElementById(`tab-${visibleTabs[next]!.id}-${tabListId}`) as HTMLButtonElement | null)?.focus()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const prev = (currentIdx - 1 + visibleTabs.length) % visibleTabs.length
        setActiveTab(visibleTabs[prev]!.id)
        ;(document.getElementById(`tab-${visibleTabs[prev]!.id}-${tabListId}`) as HTMLButtonElement | null)?.focus()
      }
    },
    [visibleTabs, setActiveTab, tabListId],
  )

  const activeTabDef = visibleTabs.find((t) => t.id === activeTab) ?? visibleTabs[0]

  return (
    <PageContainer
      title="Configuración"
      description="Gestioná las preferencias de tu sucursal, perfil y negocio."
      helpContent={helpContent[activeTabDef?.helpKey ?? 'settingsProfile']}
    >
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Secciones de configuración"
        className="flex items-center gap-1 border-b border-gray-700 pb-0"
      >
        {visibleTabs.map((tab, idx) => {
          const isActive = tab.id === activeTab
          return (
            <div key={tab.id} className="flex items-center">
              <button
                id={`tab-${tab.id}-${tabListId}`}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.id}-${tabListId}`}
                tabIndex={isActive ? 0 : -1}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={[
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 rounded-t',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500',
                ].join(' ')}
              >
                {tab.label}
              </button>
              {/* Help button per tab */}
              <HelpButton
                title={tab.helpTitle}
                content={helpContent[tab.helpKey]}
                size="sm"
              />
            </div>
          )
        })}
      </div>

      {/* Tab panels — only the active tab is mounted (task 14.4: no unnecessary fetches) */}
      <div className="mt-6">
        {activeTab === 'branch' && selectedBranchId && (
          <div
            id={`tabpanel-branch-${tabListId}`}
            role="tabpanel"
            aria-labelledby={`tab-branch-${tabListId}`}
          >
            <BranchSettingsForm branchId={selectedBranchId} />
          </div>
        )}

        {activeTab === 'branch' && !selectedBranchId && (
          <div
            id={`tabpanel-branch-${tabListId}`}
            role="tabpanel"
            aria-labelledby={`tab-branch-${tabListId}`}
            className="py-12 text-center text-gray-500 text-sm"
          >
            Seleccioná una sucursal para ver su configuración.
          </div>
        )}

        {activeTab === 'profile' && (
          <div
            id={`tabpanel-profile-${tabListId}`}
            role="tabpanel"
            aria-labelledby={`tab-profile-${tabListId}`}
          >
            <ProfileForm />
          </div>
        )}

        {activeTab === 'tenant' && (
          <div
            id={`tabpanel-tenant-${tabListId}`}
            role="tabpanel"
            aria-labelledby={`tab-tenant-${tabListId}`}
          >
            <TenantSettingsForm />
          </div>
        )}
      </div>
    </PageContainer>
  )
}
