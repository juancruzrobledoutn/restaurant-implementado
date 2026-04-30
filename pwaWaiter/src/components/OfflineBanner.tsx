/**
 * OfflineBanner — yellow banner shown when the device is offline
 * or when the retry queue has pending/failed entries.
 */
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useRetryQueueStore, selectPendingCount, selectFailedEntries } from '@/stores/retryQueueStore'

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const pendingCount = useRetryQueueStore(selectPendingCount)
  // useShallow required: selectFailedEntries returns a filtered array (new reference each call)
  const failedEntries = useRetryQueueStore(useShallow(selectFailedEntries))

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const failedCount = failedEntries.length
  const hasFailedEntries = failedCount > 0
  const isVisible = !isOnline || pendingCount > 0 || hasFailedEntries

  if (!isVisible) return null

  // Build message strings outside JSX to avoid broken text nodes in RTL.
  const pendingMsg = pendingCount > 1
    ? `${pendingCount} operaciones pendientes de sincronización`
    : `${pendingCount} operación pendiente de sincronización`

  const failedMsg = failedCount > 1
    ? `${failedCount} operaciones fallidas — revisar manualmente`
    : `${failedCount} operación fallida — revisar manualmente`

  return (
    <div
      role="alert"
      className="sticky top-0 z-30 flex items-center gap-2 bg-yellow-400 px-4 py-2 text-sm font-medium text-yellow-900"
    >
      <span className="shrink-0">⚠</span>
      <div className="flex-1">
        {!isOnline && (
          <span>Sin conexión — las operaciones se guardarán y sincronizarán al volver online.</span>
        )}
        {isOnline && pendingCount > 0 && !hasFailedEntries && (
          <span>{pendingMsg}</span>
        )}
        {hasFailedEntries && (
          <span>{failedMsg}</span>
        )}
      </div>
    </div>
  )
}
