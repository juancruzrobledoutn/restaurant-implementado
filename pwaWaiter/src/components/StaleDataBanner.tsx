/**
 * StaleDataBanner — shown when WS catchup was partial or offline gap > 5 min.
 * Offers "Actualizar" button that re-fetches tables and service calls.
 */
import { useCallback } from 'react'
import { useWaiterWsStore, selectIsStaleData, selectSetStaleData } from '@/stores/waiterWsStore'
import { useTableStore, selectLoadTables } from '@/stores/tableStore'
import { useServiceCallsStore } from '@/stores/serviceCallsStore'
import { listServiceCalls } from '@/services/waiter'
import { logger } from '@/utils/logger'

export function StaleDataBanner() {
  const isStale = useWaiterWsStore(selectIsStaleData)
  const setStaleData = useWaiterWsStore(selectSetStaleData)
  const loadTables = useTableStore(selectLoadTables)
  const hydrate = useServiceCallsStore((s) => s.hydrate)

  // useCallback with stable deps so downstream useEffect([handleRefresh]) doesn't loop.
  const handleRefresh = useCallback(async () => {
    try {
      await Promise.all([
        loadTables(),
        listServiceCalls().then(hydrate),
      ])
      setStaleData(false)
      logger.info('StaleDataBanner: refresh complete')
    } catch (err) {
      logger.error('StaleDataBanner: refresh failed', err)
    }
  }, [loadTables, hydrate, setStaleData])

  if (!isStale) return null

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 bg-orange-100 px-4 py-2 text-sm text-orange-800"
    >
      <span>Datos pueden estar desactualizados</span>
      <button
        type="button"
        onClick={() => { void handleRefresh() }}
        className="shrink-0 rounded-md bg-orange-500 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-600"
      >
        Actualizar
      </button>
    </div>
  )
}
