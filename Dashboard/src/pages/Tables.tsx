/**
 * Tables — branch-scoped table CRUD page with real-time status updates (C-16).
 *
 * Skills: dashboard-crud-page, react19-form-pattern, ws-frontend-subscription
 *
 * TABLE_STATUS_CHANGED events are handled by useTableWebSocketSync.
 * Each table belongs to a sector — the sector_id field is a Select.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useActionState } from 'react'
import { useNavigate } from 'react-router'
import { Pencil, Trash2 } from 'lucide-react'

import { PageContainer } from '@/components/ui/PageContainer'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Table } from '@/components/ui/Table'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { Pagination } from '@/components/ui/Pagination'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { HelpButton } from '@/components/ui/HelpButton'

import { useFormModal } from '@/hooks/useFormModal'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { usePagination } from '@/hooks/usePagination'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'
import { useTableWebSocketSync } from '@/hooks/useTableWebSocketSync'

import { useTableStore, selectTables, selectTableIsLoading, useTableActions } from '@/stores/tableStore'
import { useSectorStore, selectSectors } from '@/stores/sectorStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { validateTable } from '@/utils/validation'
import { handleError } from '@/utils/logger'
import { helpContent } from '@/utils/helpContent'

import type { Table as TableType, TableFormData, TableStatus } from '@/types/operations'
import type { FormState } from '@/types/form'
import type { TableColumn } from '@/components/ui/Table'

const INITIAL_FORM_DATA: TableFormData = {
  number: 0,
  code: '',
  sector_id: '',
  capacity: 2,
  status: 'AVAILABLE',
  branch_id: '',
  is_active: true,
}

const STATUS_LABELS: Record<TableStatus, string> = {
  AVAILABLE: 'Disponible',
  OCCUPIED: 'Ocupada',
  RESERVED: 'Reservada',
  OUT_OF_SERVICE: 'Fuera de servicio',
}

const STATUS_VARIANTS: Record<TableStatus, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  AVAILABLE: 'success',
  OCCUPIED: 'warning',
  RESERVED: 'info',
  OUT_OF_SERVICE: 'danger',
}

export default function TablesPage() {
  const navigate = useNavigate()

  // Stores
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const allTables = useTableStore(selectTables)
  const allSectors = useSectorStore(selectSectors)
  const isLoading = useTableStore(selectTableIsLoading)
  const { fetchByBranch, createTableAsync, updateTableAsync, deleteTableAsync } = useTableActions()

  // Real-time status updates
  useTableWebSocketSync(selectedBranchId)

  // Permissions
  const { canCreate, canEdit, canDelete } = useAuthPermissions()

  // Hook trio
  const modal = useFormModal<TableFormData, TableType>(INITIAL_FORM_DATA)
  const deleteDialog = useConfirmDialog<TableType>()

  // Filter + sort
  const filteredTables = useMemo(
    () =>
      selectedBranchId
        ? allTables.filter((t) => t.branch_id === selectedBranchId && t.is_active)
        : [],
    [allTables, selectedBranchId],
  )

  const sortedTables = useMemo(
    () => [...filteredTables].sort((a, b) => a.number - b.number),
    [filteredTables],
  )

  // Sector options for the Select input
  const sectorOptions = useMemo(
    () =>
      allSectors
        .filter((s) => s.branch_id === selectedBranchId && s.is_active)
        .map((s) => ({ value: s.id, label: s.name })),
    [allSectors, selectedBranchId],
  )

  // Sector lookup (id → name) for table rows
  const sectorById = useMemo(
    () => Object.fromEntries(allSectors.map((s) => [s.id, s.name])),
    [allSectors],
  )

  // Pagination
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } =
    usePagination(sortedTables)

  // Fetch on branch change
  useEffect(() => {
    if (selectedBranchId) void fetchByBranch(selectedBranchId)
  }, [selectedBranchId, fetchByBranch])

  // ---------------------------------------------------------------------------
  // Form submission
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (
      _prev: FormState<TableFormData>,
      formData: FormData,
    ): Promise<FormState<TableFormData>> => {
      const data: TableFormData = {
        number: parseInt(formData.get('number') as string, 10) || 0,
        code: formData.get('code') as string,
        sector_id: formData.get('sector_id') as string,
        capacity: parseInt(formData.get('capacity') as string, 10) || 2,
        status: (formData.get('status') as TableStatus) || 'AVAILABLE',
        branch_id: selectedBranchId ?? '',
        is_active: formData.get('is_active') === 'on',
      }

      const validation = validateTable(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (modal.selectedItem) {
          await updateTableAsync(modal.selectedItem.id, data)
        } else {
          await createTableAsync(data)
        }
        return { isSuccess: true }
      } catch (error) {
        const message = handleError(error, 'TablesPage.submitAction')
        return { isSuccess: false, message }
      }
    },
    [modal.selectedItem, createTableAsync, updateTableAsync, selectedBranchId],
  )

  const [state, formAction, isPending] = useActionState<FormState<TableFormData>, FormData>(
    submitAction,
    { isSuccess: false },
  )

  if (state.isSuccess && modal.isOpen) modal.close()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openEditModal = useCallback(
    (item: TableType) => {
      modal.openEdit(item, (t) => ({
        number: t.number,
        code: t.code,
        sector_id: t.sector_id,
        capacity: t.capacity,
        status: t.status,
        branch_id: t.branch_id,
        is_active: t.is_active,
      }))
    },
    [modal],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteDialog.item) return
    try {
      await deleteTableAsync(deleteDialog.item.id)
      deleteDialog.close()
    } catch (error) {
      handleError(error, 'TablesPage.handleDelete')
    }
  }, [deleteDialog, deleteTableAsync])

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<TableType>[] = useMemo(
    () => [
      {
        key: 'number',
        label: 'Nro.',
        width: 'w-16',
        render: (item) => <span className="font-semibold">{item.number}</span>,
      },
      {
        key: 'code',
        label: 'Codigo',
        width: 'w-28',
        render: (item) => <span className="text-sm font-mono">{item.code}</span>,
      },
      {
        key: 'sector_id',
        label: 'Sector',
        render: (item) => (
          <span className="text-sm">{sectorById[item.sector_id] ?? '—'}</span>
        ),
      },
      {
        key: 'capacity',
        label: 'Capacidad',
        width: 'w-24',
        render: (item) => <span className="text-sm">{item.capacity} pers.</span>,
      },
      {
        key: 'status',
        label: 'Estado',
        width: 'w-36',
        render: (item) => (
          <Badge variant={STATUS_VARIANTS[item.status] ?? 'neutral'}>
            {STATUS_LABELS[item.status] ?? item.status}
          </Badge>
        ),
      },
      {
        key: 'actions',
        label: 'Acciones',
        width: 'w-24',
        render: (item) => (
          <div className="flex items-center gap-1">
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); openEditModal(item) }}
                aria-label={`Editar mesa ${item.number}`}
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); deleteDialog.open(item) }}
                className="text-[var(--danger-icon)] hover:text-[var(--danger-text)] hover:bg-[var(--danger-border)]/10"
                aria-label={`Eliminar mesa ${item.number}`}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canEdit, canDelete, openEditModal, deleteDialog, sectorById],
  )

  // ---------------------------------------------------------------------------
  // Branch guard
  // ---------------------------------------------------------------------------
  if (!selectedBranchId) {
    return (
      <PageContainer
        title="Mesas"
        description="Selecciona una sucursal para ver sus mesas"
        helpContent={helpContent.tables}
      >
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)] mb-4">
            Selecciona una sucursal desde el Dashboard para ver sus mesas
          </p>
          <Button onClick={() => navigate('/')}>Ir al Dashboard</Button>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title="Mesas"
      description="Gestiona las mesas de la sucursal seleccionada."
      helpContent={helpContent.tables}
      actions={
        canCreate ? (
          <Button
            onClick={() =>
              modal.openCreate({
                ...INITIAL_FORM_DATA,
                branch_id: selectedBranchId,
                sector_id: sectorOptions[0]?.value ?? '',
              })
            }
          >
            Nueva Mesa
          </Button>
        ) : undefined
      }
    >
      <Card>
        {isLoading ? (
          <TableSkeleton rows={5} columns={6} />
        ) : (
          <Table
            columns={columns}
            items={paginatedItems}
            rowKey={(item) => item.id}
            emptyMessage="No hay mesas. Crea la primera con el boton superior."
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

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modal.isOpen}
        onClose={modal.close}
        title={modal.selectedItem ? 'Editar Mesa' : 'Nueva Mesa'}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>Cancelar</Button>
            <Button type="submit" form="table-form" isLoading={isPending}>
              {modal.selectedItem ? 'Guardar' : 'Crear'}
            </Button>
          </>
        }
      >
        <form id="table-form" action={formAction} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Mesa"
              size="sm"
              content={
                <div className="space-y-3">
                  <p><strong>Completa los campos</strong> para crear o editar una mesa:</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Numero:</strong> Numero de mesa visible para el personal.</li>
                    <li><strong>Codigo:</strong> Codigo QR o interno de la mesa (ej: A-01).</li>
                    <li><strong>Sector:</strong> Zona fisica donde esta la mesa.</li>
                    <li><strong>Capacidad:</strong> Cantidad maxima de comensales.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda sobre el formulario</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Numero de mesa"
              name="number"
              type="number"
              value={String(modal.formData.number)}
              onChange={(e) =>
                modal.setFormData((prev) => ({
                  ...prev,
                  number: parseInt(e.target.value, 10) || 0,
                }))
              }
              error={state.errors?.number}
              required
            />
            <Input
              label="Codigo"
              name="code"
              placeholder="ej: A-01"
              value={modal.formData.code}
              onChange={(e) =>
                modal.setFormData((prev) => ({ ...prev, code: e.target.value }))
              }
              error={state.errors?.code}
              required
            />
          </div>

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

          <Input
            label="Capacidad (personas)"
            name="capacity"
            type="number"
            value={String(modal.formData.capacity)}
            onChange={(e) =>
              modal.setFormData((prev) => ({
                ...prev,
                capacity: parseInt(e.target.value, 10) || 2,
              }))
            }
            error={state.errors?.capacity}
          />

          <Select
            label="Estado"
            name="status"
            value={modal.formData.status}
            onChange={(e) =>
              modal.setFormData((prev) => ({ ...prev, status: e.target.value as TableStatus }))
            }
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />

          <Toggle
            label="Activa"
            name="is_active"
            checked={modal.formData.is_active}
            onChange={(e) =>
              modal.setFormData((prev) => ({ ...prev, is_active: e.target.checked }))
            }
          />
        </form>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={deleteDialog.close}
        onConfirm={handleDelete}
        title="Eliminar Mesa"
        message={`¿Estas seguro de eliminar la mesa ${deleteDialog.item?.number} (${deleteDialog.item?.code})?`}
        confirmLabel="Eliminar"
      />
    </PageContainer>
  )
}
