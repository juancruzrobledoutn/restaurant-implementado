/**
 * WaiterAssignments — daily waiter-to-sector assignment management (C-16).
 *
 * Skills: dashboard-crud-page, react19-form-pattern
 *
 * Behavior:
 * - Create / delete only — no edit (assignments are ephemeral daily records)
 * - DatePicker in header defaults to today and persists via waiterAssignmentStore
 * - user_id is a Select filtered to WAITERs of the current branch
 * - sector_id is a Select populated from sectorStore
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useActionState } from 'react'
import { useNavigate } from 'react-router'
import { Trash2 } from 'lucide-react'

import { PageContainer } from '@/components/ui/PageContainer'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Table } from '@/components/ui/Table'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { HelpButton } from '@/components/ui/HelpButton'

import { useFormModal } from '@/hooks/useFormModal'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { usePagination } from '@/hooks/usePagination'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'

import {
  useWaiterAssignmentStore,
  selectAssignments,
  selectSelectedDate,
  selectWaiterAssignmentIsLoading,
  useWaiterAssignmentActions,
} from '@/stores/waiterAssignmentStore'
import { useWaitersByBranch } from '@/stores/staffStore'
import { useSectorsByBranch } from '@/stores/sectorStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { validateWaiterAssignment } from '@/utils/validation'
import { handleError } from '@/utils/logger'
import { helpContent } from '@/utils/helpContent'

import type { WaiterAssignment, WaiterAssignmentFormData } from '@/types/operations'
import type { FormState } from '@/types/form'
import type { TableColumn } from '@/components/ui/Table'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

const INITIAL_FORM_DATA: WaiterAssignmentFormData = {
  user_id: '',
  sector_id: '',
  date: todayISO(),
}

export default function WaiterAssignmentsPage() {
  const navigate = useNavigate()

  // Stores
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const assignments = useWaiterAssignmentStore(selectAssignments)
  const selectedDate = useWaiterAssignmentStore(selectSelectedDate)
  const isLoading = useWaiterAssignmentStore(selectWaiterAssignmentIsLoading)
  const { fetchByDate, createAsync, deleteAsync, setDate } = useWaiterAssignmentActions()

  // Waiters and sectors for selects — filtered to branch
  const waiters = useWaitersByBranch(selectedBranchId ?? '')
  const sectors = useSectorsByBranch(selectedBranchId ?? '')

  const waiterOptions = useMemo(
    () =>
      waiters.map((u) => ({
        value: u.id,
        label: `${u.first_name} ${u.last_name} (${u.email})`,
      })),
    [waiters],
  )

  const sectorOptions = useMemo(
    () => sectors.map((s) => ({ value: s.id, label: s.name })),
    [sectors],
  )

  // Permissions
  const { canCreate } = useAuthPermissions()

  // Hook trio
  const modal = useFormModal<WaiterAssignmentFormData, WaiterAssignment>(INITIAL_FORM_DATA)
  const deleteDialog = useConfirmDialog<WaiterAssignment>()

  // Pagination
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } =
    usePagination(assignments)

  // Fetch on branch / date change
  useEffect(() => {
    if (selectedBranchId) void fetchByDate(selectedDate, selectedBranchId)
  }, [selectedBranchId, selectedDate, fetchByDate])

  // ---------------------------------------------------------------------------
  // Form submission — create only
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (
      _prev: FormState<WaiterAssignmentFormData>,
      formData: FormData,
    ): Promise<FormState<WaiterAssignmentFormData>> => {
      const data: WaiterAssignmentFormData = {
        user_id: formData.get('user_id') as string,
        sector_id: formData.get('sector_id') as string,
        date: selectedDate,
      }

      const validation = validateWaiterAssignment(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        await createAsync(data.sector_id, data.user_id, data.date)
        return { isSuccess: true }
      } catch (error) {
        const message = handleError(error, 'WaiterAssignmentsPage.submitAction')
        return { isSuccess: false, message }
      }
    },
    [createAsync, selectedDate],
  )

  const [state, formAction, isPending] = useActionState<
    FormState<WaiterAssignmentFormData>,
    FormData
  >(submitAction, { isSuccess: false })

  if (state.isSuccess && modal.isOpen) modal.close()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleDelete = useCallback(async () => {
    if (!deleteDialog.item) return
    try {
      await deleteAsync(deleteDialog.item.id)
      deleteDialog.close()
    } catch (error) {
      handleError(error, 'WaiterAssignmentsPage.handleDelete')
    }
  }, [deleteDialog, deleteAsync])

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<WaiterAssignment>[] = useMemo(
    () => [
      {
        key: 'user',
        label: 'Mozo',
        render: (item) =>
          item.user ? (
            <span className="font-medium">
              {item.user.first_name} {item.user.last_name}
            </span>
          ) : (
            <span className="text-sm text-gray-500">ID: {item.user_id}</span>
          ),
      },
      {
        key: 'sector',
        label: 'Sector',
        render: (item) =>
          item.sector ? (
            <span className="text-sm">{item.sector.name}</span>
          ) : (
            <span className="text-sm text-gray-500">ID: {item.sector_id}</span>
          ),
      },
      {
        key: 'date',
        label: 'Fecha',
        width: 'w-32',
        render: (item) => <span className="text-sm font-mono">{item.date}</span>,
      },
      {
        key: 'actions',
        label: 'Acciones',
        width: 'w-20',
        render: (item) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); deleteDialog.open(item) }}
            className="text-[var(--danger-icon)] hover:text-[var(--danger-text)] hover:bg-[var(--danger-border)]/10"
            aria-label="Eliminar asignacion"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </Button>
        ),
      },
    ],
    [deleteDialog],
  )

  // ---------------------------------------------------------------------------
  // Branch guard
  // ---------------------------------------------------------------------------
  if (!selectedBranchId) {
    return (
      <PageContainer
        title="Asignacion de Mozos"
        description="Selecciona una sucursal para ver las asignaciones"
        helpContent={helpContent.waiterAssignments}
      >
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)] mb-4">
            Selecciona una sucursal desde el Dashboard
          </p>
          <Button onClick={() => navigate('/')}>Ir al Dashboard</Button>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title="Asignacion de Mozos"
      description="Asigna mozos a sectores por dia."
      helpContent={helpContent.waiterAssignments}
      actions={
        canCreate ? (
          <Button
            onClick={() =>
              modal.openCreate({
                user_id: waiterOptions[0]?.value ?? '',
                sector_id: sectorOptions[0]?.value ?? '',
                date: selectedDate,
              })
            }
          >
            Nueva Asignacion
          </Button>
        ) : undefined
      }
    >
      {/* Date picker in header area */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-gray-300">Fecha:</label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/70"
          aria-label="Seleccionar fecha de asignaciones"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDate(todayISO())}
        >
          Hoy
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={5} columns={4} />
        ) : (
          <Table
            columns={columns}
            items={paginatedItems}
            rowKey={(item) => item.id}
            emptyMessage="No hay mozos asignados para esta fecha."
          />
        )}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
        />
      </Card>

      {/* Create Modal */}
      <Modal
        isOpen={modal.isOpen}
        onClose={modal.close}
        title="Nueva Asignacion"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>Cancelar</Button>
            <Button type="submit" form="assignment-form" isLoading={isPending}>
              Asignar
            </Button>
          </>
        }
      >
        <form id="assignment-form" action={formAction} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Asignar Mozo"
              size="sm"
              content={
                <div className="space-y-3">
                  <p>Selecciona el mozo y el sector para la fecha seleccionada.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Mozo:</strong> Solo aparecen usuarios con rol WAITER en esta sucursal.</li>
                    <li><strong>Sector:</strong> Zona de la sucursal donde trabajara el mozo.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda</span>
          </div>

          <p className="text-sm text-gray-400">
            Fecha de asignacion: <strong className="text-white">{selectedDate}</strong>
          </p>

          <Select
            label="Mozo"
            name="user_id"
            value={modal.formData.user_id}
            onChange={(e) =>
              modal.setFormData((prev) => ({ ...prev, user_id: e.target.value }))
            }
            options={waiterOptions}
            placeholder="Selecciona un mozo"
            error={state.errors?.user_id}
            required
          />

          <Select
            label="Sector"
            name="sector_id"
            value={modal.formData.sector_id}
            onChange={(e) =>
              modal.setFormData((prev) => ({ ...prev, sector_id: e.target.value }))
            }
            options={sectorOptions}
            placeholder="Selecciona un sector"
            error={state.errors?.sector_id}
            required
          />

          {waiterOptions.length === 0 && (
            <p className="text-xs text-yellow-400">
              No hay mozos asignados a esta sucursal. Agrega personal con rol WAITER primero.
            </p>
          )}

          {sectorOptions.length === 0 && (
            <p className="text-xs text-yellow-400">
              No hay sectores activos en esta sucursal. Crea sectores primero.
            </p>
          )}

          {state.message && (
            <p className="text-sm text-red-400" role="alert">
              {state.message}
            </p>
          )}

          {/* Hidden field — date is from store, not from form input */}
          <input type="hidden" name="date" value={selectedDate} />
        </form>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={deleteDialog.close}
        onConfirm={handleDelete}
        title="Eliminar Asignacion"
        message="¿Estas seguro de eliminar esta asignacion?"
        confirmLabel="Eliminar"
      />
    </PageContainer>
  )
}
