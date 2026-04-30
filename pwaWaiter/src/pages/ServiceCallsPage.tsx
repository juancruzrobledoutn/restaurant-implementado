/**
 * ServiceCallsPage — /service-calls
 *
 * Global inbox of service calls. Optionally filtered by sector.
 * Supports ACK and Close operations.
 */
import { useEffect, useState } from 'react'
import { useAuthStore, selectAssignedSectorId } from '@/stores/authStore'
import {
  useServiceCallsStore,
  useActiveCalls,
  useCallsBySector,
} from '@/stores/serviceCallsStore'
import { ServiceCallItem } from '@/components/ServiceCallItem'
import { OfflineBanner } from '@/components/OfflineBanner'
import { listServiceCalls, ackServiceCall, closeServiceCall } from '@/services/waiter'
import { generateClientOpId } from '@/lib/idempotency'
import { logger } from '@/utils/logger'

export default function ServiceCallsPage() {
  const assignedSectorId = useAuthStore(selectAssignedSectorId)
  const hydrate = useServiceCallsStore((s) => s.hydrate)
  const upsert = useServiceCallsStore((s) => s.upsert)
  const remove = useServiceCallsStore((s) => s.remove)

  // filterSector: 'all' → show all active calls; any other string → show only calls for that sector
  const [filterSector, setFilterSector] = useState<string>(assignedSectorId ?? 'all')

  const activeCalls = useActiveCalls()
  const sectorCalls = useCallsBySector(filterSector !== 'all' ? filterSector : '')

  // Apply sector filter: when filterSector is 'all' show all active calls;
  // otherwise show only calls whose sector_id matches filterSector.
  const displayCalls = filterSector !== 'all' ? sectorCalls : activeCalls

  const [isLoading, setIsLoading] = useState(false)
  const [ackingCall, setAckingCall] = useState<string | null>(null)
  const [closingCall, setClosingCall] = useState<string | null>(null)

  // Fetch on mount
  useEffect(() => {
    setIsLoading(true)
    listServiceCalls()
      .then(hydrate)
      .catch((err) => logger.error('ServiceCallsPage: listServiceCalls failed', err))
      .finally(() => setIsLoading(false))
  }, [hydrate])

  async function handleAck(id: string) {
    setAckingCall(id)
    try {
      const clientOpId = generateClientOpId()
      const updated = await ackServiceCall(id, clientOpId)
      upsert(updated)
    } catch (err) {
      logger.error('ServiceCallsPage: ackServiceCall failed', err)
    } finally {
      setAckingCall(null)
    }
  }

  async function handleClose(id: string) {
    setClosingCall(id)
    try {
      const clientOpId = generateClientOpId()
      await closeServiceCall(id, clientOpId)
      remove(id)
    } catch (err) {
      logger.error('ServiceCallsPage: closeServiceCall failed', err)
    } finally {
      setClosingCall(null)
    }
  }

  return (
    <div>
      <OfflineBanner />
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Llamados de servicio</h1>
          {assignedSectorId && (
            <button
              type="button"
              onClick={() =>
                setFilterSector((v) => (v === 'all' ? assignedSectorId : 'all'))
              }
              className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
            >
              {filterSector !== 'all' ? 'Ver todos' : 'Mi sector'}
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : displayCalls.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
            No hay llamados activos
          </div>
        ) : (
          <div className="space-y-3">
            {displayCalls.map((call) => (
              <ServiceCallItem
                key={call.id}
                call={call}
                onAck={handleAck}
                onClose={handleClose}
                isAcking={ackingCall === call.id}
                isClosing={closingCall === call.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
