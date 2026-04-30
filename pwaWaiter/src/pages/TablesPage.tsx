/**
 * TablesPage — home of the waiter after successful verify-branch-assignment.
 *
 * C-21 changes:
 * - Fetches real table data via tableStore.loadTables() on mount
 * - Groups tables by sector using bySector index
 * - Registers global WS subscriptions via useGlobalWaiterSubscriptions
 * - Renders OfflineBanner and StaleDataBanner
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useAuthStore,
  selectAssignedSectorName,
} from '@/stores/authStore'
import { useTableStore, selectTables, selectLoadTables, selectTablesFetchStatus } from '@/stores/tableStore'
import { SectorGroup } from '@/components/tables/SectorGroup'
import { OfflineBanner } from '@/components/OfflineBanner'
import { StaleDataBanner } from '@/components/StaleDataBanner'
import { useGlobalWaiterSubscriptions } from '@/hooks/useWaiterSubscriptions'
import {
  registerPushSubscription,
} from '@/services/push'

export default function TablesPage() {
  const navigate = useNavigate()
  const sectorName = useAuthStore(selectAssignedSectorName)
  const tables = useTableStore(selectTables)
  const loadTables = useTableStore(selectLoadTables)
  const fetchStatus = useTableStore(selectTablesFetchStatus)

  const [pushState, setPushState] = useState<
    'hidden' | 'idle' | 'registering' | 'granted' | 'denied' | 'not_supported'
  >('idle')
  const [pushError, setPushError] = useState<string | null>(null)

  // Register global WS subscriptions (ref pattern)
  useGlobalWaiterSubscriptions()

  // Fetch real tables on mount
  useEffect(() => {
    void loadTables()
  }, [loadTables])

  // Initial push permission check
  useEffect(() => {
    if (typeof Notification === 'undefined') {
      setPushState('not_supported')
      return
    }
    if (Notification.permission === 'granted') {
      setPushState('granted')
    } else if (Notification.permission === 'denied') {
      setPushState('denied')
    } else {
      setPushState('idle')
    }
  }, [])

  const handleActivatePush = async () => {
    setPushState('registering')
    setPushError(null)
    const result = await registerPushSubscription()
    if (result.success) {
      setPushState('granted')
    } else {
      if (result.reason === 'permission_denied') {
        setPushState('denied')
      } else if (result.reason === 'not_supported') {
        setPushState('not_supported')
      } else {
        setPushState('idle')
        setPushError(
          result.reason === 'no_vapid_key'
            ? 'Notificaciones no configuradas en el servidor.'
            : 'No pudimos activar las notificaciones.',
        )
      }
    }
  }

  const handleTableClick = (tableId: string) => {
    void navigate(`/tables/${tableId}`)
  }

  // Group tables by sector for multi-sector support
  const sectorMap = new Map<string, { name: string; tables: typeof tables }>()
  for (const table of tables) {
    if (!sectorMap.has(table.sectorId)) {
      sectorMap.set(table.sectorId, { name: table.sectorName, tables: [] })
    }
    sectorMap.get(table.sectorId)!.tables.push(table)
  }

  return (
    <div>
      <OfflineBanner />
      <StaleDataBanner />

      <div className="p-4">
        {pushState === 'idle' ? (
          <div className="mb-6 flex flex-col items-start gap-3 rounded-md border border-primary bg-orange-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">
                Activá las notificaciones push
              </p>
              <p className="text-xs text-gray-600">
                Te avisamos cuando se abra una mesa nueva o se llame al mozo.
              </p>
              {pushError ? (
                <p className="mt-1 text-xs text-red-700">{pushError}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void handleActivatePush()}
              className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary"
            >
              Activar notificaciones
            </button>
          </div>
        ) : null}

        {pushState === 'registering' ? (
          <div className="mb-6 rounded-md border border-gray-300 bg-white p-3 text-xs text-gray-600">
            Registrando suscripción…
          </div>
        ) : null}

        <header className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">Mis mesas</h1>
          <p className="text-sm text-gray-600">
            {sectorName ? `Sector: ${sectorName}` : 'Sin sector asignado'}
          </p>
        </header>

        {fetchStatus === 'loading' && tables.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : tables.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
            No hay mesas asignadas a tu sector.
          </div>
        ) : (
          Array.from(sectorMap.entries()).map(([sectorId, sector]) => (
            <SectorGroup
              key={sectorId}
              sectorName={sector.name}
              tables={sector.tables}
              onTableClick={handleTableClick}
            />
          ))
        )}
      </div>
    </div>
  )
}
