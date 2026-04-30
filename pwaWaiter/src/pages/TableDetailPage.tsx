/**
 * TableDetailPage — /tables/:tableId
 *
 * Shows:
 * - Table status and session info
 * - "Activar mesa" button if no active session
 * - "Comanda rápida" button
 * - Rounds list with confirm button for PENDING
 * - Service calls for this table
 * - "Solicitar cuenta" / "Registrar pago" actions
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useTableStore, selectTableById } from '@/stores/tableStore'
import { useRoundsStore, useRoundsBySession } from '@/stores/roundsStore'
import { useServiceCallsStore, useCallsByTable } from '@/stores/serviceCallsStore'
import { useTableSubscriptions } from '@/hooks/useWaiterSubscriptions'
import { RoundCard } from '@/components/RoundCard'
import { ServiceCallItem } from '@/components/ServiceCallItem'
import { ManualPaymentForm } from '@/components/ManualPaymentForm'
import { OfflineBanner } from '@/components/OfflineBanner'
import { StaleDataBanner } from '@/components/StaleDataBanner'
import {
  activateTable,
  confirmRound,
  listSessionRounds,
  requestCheck,
  ackServiceCall,
  closeServiceCall,
  closeTable,
} from '@/services/waiter'
import { generateClientOpId } from '@/lib/idempotency'
import { logger } from '@/utils/logger'
import type { ManualPaymentFormData } from '@/components/ManualPaymentForm'
import { submitManualPayment } from '@/services/waiter'
import { useRetryQueueStore, selectEntriesBySession } from '@/stores/retryQueueStore'
import { useAuthStore, selectUser } from '@/stores/authStore'

export default function TableDetailPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const navigate = useNavigate()

  const table = useTableStore(selectTableById(tableId ?? ''))
  const sessionId = table?.sessionId ?? null

  // Register WS subscriptions for this table's session
  useTableSubscriptions(tableId ?? '', sessionId)

  const rounds = useRoundsBySession(sessionId ?? '')
  const serviceCalls = useCallsByTable(tableId ?? '')

  const upsertRound = useRoundsStore((s) => s.upsertRound)
  const upsertServiceCall = useServiceCallsStore((s) => s.upsert)
  const removeServiceCall = useServiceCallsStore((s) => s.remove)

  // Check pending payments in retry queue
  const pendingPayments = useRetryQueueStore(
    useShallow(selectEntriesBySession(sessionId ?? '')),
  )
  const hasPendingPayments = pendingPayments.some((e) => e.op === 'submitManualPayment' && !e.failed)

  const currentUser = useAuthStore(selectUser)

  const [isActivating, setIsActivating] = useState(false)
  const [isRequestingCheck, setIsRequestingCheck] = useState(false)
  const [isClosingTable, setIsClosingTable] = useState(false)
  const [confirmingRound, setConfirmingRound] = useState<string | null>(null)
  const [ackingCall, setAckingCall] = useState<string | null>(null)
  const [closingCall, setClosingCall] = useState<string | null>(null)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [roundStatusFilter, setRoundStatusFilter] = useState<'all' | 'pending' | 'ready' | 'served'>('all')

  // Load existing rounds from API when visiting a session for the first time
  useEffect(() => {
    if (!sessionId) return
    listSessionRounds(sessionId)
      .then((rounds) => {
        const { upsertRound } = useRoundsStore.getState()
        rounds.forEach((r) => upsertRound(r))
      })
      .catch((err) => logger.error('TableDetailPage: listSessionRounds failed', err))
  }, [sessionId])

  if (!table) {
    return (
      <div className="p-4 text-sm text-gray-600">
        Mesa no encontrada.
        <button
          type="button"
          onClick={() => void navigate('/tables')}
          className="ml-2 text-primary underline"
        >
          Volver
        </button>
      </div>
    )
  }

  const hasActiveSession = !!sessionId
  const canRequestCheck = hasActiveSession && table.status === 'ACTIVE'
  const canCloseTable = table.status === 'PAYING' && !hasPendingPayments

  async function handleActivate() {
    if (!tableId) return
    setIsActivating(true)
    setErrorMsg(null)
    try {
      const session = await activateTable(tableId)
      useTableStore.getState().applySessionStarted(tableId, session.id)
      logger.info(`TableDetailPage: table ${tableId} activated — session ${session.id}`)
    } catch (err) {
      logger.error('TableDetailPage: activateTable failed', err)
      setErrorMsg('Error al activar la mesa')
    } finally {
      setIsActivating(false)
    }
  }

  async function handleConfirmRound(roundId: string) {
    if (!sessionId) return
    setConfirmingRound(roundId)
    setErrorMsg(null)
    try {
      const clientOpId = generateClientOpId()
      const updated = await confirmRound(sessionId, roundId, clientOpId)
      upsertRound(updated)
    } catch (err) {
      logger.error('TableDetailPage: confirmRound failed', err)
      setErrorMsg('Error al confirmar el pedido')
    } finally {
      setConfirmingRound(null)
    }
  }

  async function handleRequestCheck() {
    if (!sessionId) return
    setIsRequestingCheck(true)
    setErrorMsg(null)
    try {
      const clientOpId = generateClientOpId()
      await requestCheck(sessionId, clientOpId)
      // TABLE state updated by WS event CHECK_REQUESTED
    } catch (err) {
      logger.error('TableDetailPage: requestCheck failed', err)
      setErrorMsg('Error al solicitar la cuenta')
    } finally {
      setIsRequestingCheck(false)
    }
  }

  async function handleAckServiceCall(id: string) {
    setAckingCall(id)
    setErrorMsg(null)
    try {
      const clientOpId = generateClientOpId()
      const updated = await ackServiceCall(id, clientOpId)
      upsertServiceCall(updated)
    } catch (err) {
      logger.error('TableDetailPage: ackServiceCall failed', err)
      setErrorMsg('Error al acusar recibo')
    } finally {
      setAckingCall(null)
    }
  }

  async function handleCloseServiceCall(id: string) {
    setClosingCall(id)
    try {
      const clientOpId = generateClientOpId()
      await closeServiceCall(id, clientOpId)
      removeServiceCall(id)
    } catch (err) {
      logger.error('TableDetailPage: closeServiceCall failed', err)
    } finally {
      setClosingCall(null)
    }
  }

  async function handleCloseTable() {
    if (!tableId) return
    setIsClosingTable(true)
    try {
      const clientOpId = generateClientOpId()
      await closeTable(tableId, clientOpId)
      void navigate('/tables')
    } catch (err) {
      logger.error('TableDetailPage: closeTable failed', err)
      setErrorMsg('Error al cerrar la mesa')
    } finally {
      setIsClosingTable(false)
    }
  }

  async function handlePaymentSubmit(data: ManualPaymentFormData) {
    const clientOpId = generateClientOpId()
    try {
      await submitManualPayment(data, clientOpId)
      return { status: 'success' }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('network')) {
        await useRetryQueueStore.getState().enqueue({
          userId: currentUser?.id?.toString() ?? '',
          op: 'submitManualPayment',
          payload: { ...data, clientOpId },
        })
        return { status: 'queued' }
      }
      return { status: 'failed', message: err instanceof Error ? err.message : 'Error' }
    }
  }

  const PENDING_STATUSES = ['PENDING', 'CONFIRMED', 'SUBMITTED', 'IN_KITCHEN']
  const filteredRounds = rounds.filter((r) => {
    if (roundStatusFilter === 'all') return true
    if (roundStatusFilter === 'pending') return PENDING_STATUSES.includes(r.status)
    if (roundStatusFilter === 'ready') return r.status === 'READY'
    return r.status === 'SERVED'
  })
  const pendingCount = rounds.filter((r) => PENDING_STATUSES.includes(r.status)).length
  const readyCount = rounds.filter((r) => r.status === 'READY').length
  const servedCount = rounds.filter((r) => r.status === 'SERVED').length

  const STATUS_LABELS: Record<string, string> = {
    AVAILABLE: 'Disponible',
    OCCUPIED: 'Ocupada',
    ACTIVE: 'Activa',
    PAYING: 'Cobrando',
    OUT_OF_SERVICE: 'Fuera de servicio',
  }

  return (
    <div>
      <OfflineBanner />
      <StaleDataBanner />

      <div className="p-4">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void navigate('/tables')}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Volver"
          >
            ←
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Mesa {table.code}</h1>
            <p className="text-sm text-gray-600">
              {STATUS_LABELS[table.status] ?? table.status} · {table.sectorName}
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {/* Primary actions */}
        <div className="mb-4 flex flex-wrap gap-2">
          {!hasActiveSession && (
            <button
              type="button"
              onClick={() => void handleActivate()}
              disabled={isActivating}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {isActivating ? 'Activando…' : 'Activar mesa'}
            </button>
          )}

          {hasActiveSession && (
            <button
              type="button"
              onClick={() => void navigate(`/tables/${tableId}/quick-order`)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
            >
              Comanda rápida
            </button>
          )}

          {canRequestCheck && (
            <button
              type="button"
              onClick={() => void handleRequestCheck()}
              disabled={isRequestingCheck}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {isRequestingCheck ? 'Solicitando…' : 'Solicitar cuenta'}
            </button>
          )}

          {table.status === 'PAYING' && (
            <button
              type="button"
              onClick={() => setShowPaymentForm((v) => !v)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Registrar pago
            </button>
          )}

          {canCloseTable && (
            <button
              type="button"
              onClick={() => void handleCloseTable()}
              disabled={isClosingTable}
              className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {isClosingTable ? 'Cerrando…' : 'Cerrar mesa'}
            </button>
          )}

          {hasPendingPayments && table.status === 'PAYING' && (
            <p className="mt-1 w-full text-xs text-yellow-700">
              Hay pagos pendientes de sincronización — no se puede cerrar la mesa aún.
            </p>
          )}
        </div>

        {/* Manual payment form */}
        {showPaymentForm && sessionId && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-gray-800">Registrar pago</h2>
            <ManualPaymentForm
              sessionId={sessionId}
              onSuccess={() => setShowPaymentForm(false)}
              onSubmit={handlePaymentSubmit}
            />
          </div>
        )}

        {/* Rounds */}
        {rounds.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-base font-semibold text-gray-800">Pedidos</h2>
            <div className="mb-3 flex gap-1 overflow-x-auto">
              {(
                [
                  { key: 'all', label: 'Todos', count: rounds.length },
                  { key: 'pending', label: 'Pendientes', count: pendingCount },
                  { key: 'ready', label: 'Listos', count: readyCount },
                  { key: 'served', label: 'Servidos', count: servedCount },
                ] as const
              ).map(({ key, label, count }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRoundStatusFilter(key)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    roundStatusFilter === key
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        roundStatusFilter === key
                          ? 'bg-white/20'
                          : 'bg-gray-300 text-gray-700'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {filteredRounds.map((round) => (
                <RoundCard
                  key={round.id}
                  round={round}
                  onConfirm={handleConfirmRound}
                  isPending={confirmingRound === round.id}
                />
              ))}
              {filteredRounds.length === 0 && (
                <p className="text-center text-sm text-gray-500">
                  No hay pedidos en este estado.
                </p>
              )}
            </div>
          </section>
        )}

        {/* Service calls */}
        {serviceCalls.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-base font-semibold text-gray-800">Llamados de servicio</h2>
            <div className="space-y-2">
              {serviceCalls.map((call) => (
                <ServiceCallItem
                  key={call.id}
                  call={call}
                  onAck={handleAckServiceCall}
                  onClose={handleCloseServiceCall}
                  isAcking={ackingCall === call.id}
                  isClosing={closingCall === call.id}
                />
              ))}
            </div>
          </section>
        )}

        {!hasActiveSession && rounds.length === 0 && serviceCalls.length === 0 && (
          <p className="text-center text-sm text-gray-500">
            La mesa no tiene sesión activa. Activala para comenzar a tomar pedidos.
          </p>
        )}
      </div>
    </div>
  )
}
