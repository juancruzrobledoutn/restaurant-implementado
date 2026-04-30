/**
 * Sectors — branch-scoped sector CRUD page (C-16).
 *
 * Skills: dashboard-crud-page, react19-form-pattern, help-system-content
 *
 * Cascade: deleting a sector soft-deletes all its tables (server-side).
 * The cascade preview is computed from the already-hydrated tableStore.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { Toggle } from '@/components/ui/Toggle'
import { HelpButton } from '@/components/ui/HelpButton'
import { CascadePreviewList } from '@/components/ui/CascadePreviewList'

import { useFormModal } from '@/hooks/useFormModal'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { usePagination } from '@/hooks/usePagination'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'

import { useSectorStore, selectSectors, selectSectorIsLoading, useSectorActions } from '@/stores/sectorStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { getSectorPreview, deleteSectorWithCascade } from '@/services/cascadeService'
import { validateSector } from '@/utils/validation'
import { handleError } from '@/utils/logger'
import { helpContent } from '@/utils/helpContent'

import type { Sector, SectorFormData } from '@/types/operations'
import type { CascadePreview } from '@/types/menu'
import type { FormState } from '@/types/form'
import type { TableColumn } from '@/components/ui/Table'

const INITIAL_FORM_DATA: SectorFormData = {
  name: '',
  branch_id: '',
  is_active: true,
}

export default function SectorsPage() {
  const navigate = useNavigate()

  // Store
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const allItems = useSectorStore(selectSectors)
  const isLoading = useSectorStore(selectSectorIsLoading)
  const { fetchByBranch, createSectorAsync, updateSectorAsync } = useSectorActions()

  // Permissions
  const { canCreate, canEdit, canDelete } = useAuthPermissions()

  // Hook trio
  const modal = useFormModal<SectorFormData, Sector>(INITIAL_FORM_DATA)
  const deleteDialog = useConfirmDialog<Sector>()

  // Filter + sort
  const filteredItems = useMemo(
    () => (selectedBranchId ? allItems.filter((s) => s.branch_id === selectedBranchId) : []),
    [allItems, selectedBranchId],
  )

  const sortedItems = useMemo(
    () => [...filteredItems].sort((a, b) => a.name.localeCompare(b.name)),
    [filteredItems],
  )

  // Pagination
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } =
    usePagination(sortedItems)

  // Cascade preview
  const [cascadePreview, setCascadePreview] = useState<CascadePreview | null>(null)

  // Fetch on branch change
  useEffect(() => {
    if (selectedBranchId) void fetchByBranch(selectedBranchId)
  }, [selectedBranchId, fetchByBranch])

  // ---------------------------------------------------------------------------
  // Form submission
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (
      _prev: FormState<SectorFormData>,
      formData: FormData,
    ): Promise<FormState<SectorFormData>> => {
      const data: SectorFormData = {
        name: formData.get('name') as string,
        branch_id: selectedBranchId ?? '',
        is_active: formData.get('is_active') === 'on',
      }

      const validation = validateSector(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (modal.selectedItem) {
          await updateSectorAsync(modal.selectedItem.id, data)
        } else {
          await createSectorAsync(data)
        }
        return { isSuccess: true }
      } catch (error) {
        const message = handleError(error, 'SectorsPage.submitAction')
        return { isSuccess: false, message }
      }
    },
    [modal.selectedItem, createSectorAsync, updateSectorAsync, selectedBranchId],
  )

  const [state, formAction, isPending] = useActionState<FormState<SectorFormData>, FormData>(
    submitAction,
    { isSuccess: false },
  )

  if (state.isSuccess && modal.isOpen) modal.close()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openEditModal = useCallback(
    (item: Sector) => {
      modal.openEdit(item, (s) => ({
        name: s.name,
        branch_id: s.branch_id,
        is_active: s.is_active,
      }))
    },
    [modal],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteDialog.item) return
    try {
      await deleteSectorWithCascade(deleteDialog.item.id)
      deleteDialog.close()
      setCascadePreview(null)
    } catch (error) {
      handleError(error, 'SectorsPage.handleDelete')
    }
  }, [deleteDialog])

  useEffect(() => {
    if (deleteDialog.isOpen && deleteDialog.item) {
      getSectorPreview(deleteDialog.item.id)
        .then(setCascadePreview)
        .catch(() => setCascadePreview(null))
    } else {
      void Promise.resolve().then(() => setCascadePreview(null))
    }
  }, [deleteDialog.isOpen, deleteDialog.item])

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<Sector>[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Nombre',
        render: (item) => <span className="font-medium">{item.name}</span>,
      },
      {
        key: 'is_active',
        label: 'Estado',
        width: 'w-24',
        render: (item) =>
          item.is_active ? (
            <Badge variant="success">Activo</Badge>
          ) : (
            <Badge variant="danger">Inactivo</Badge>
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
                aria-label={`Editar ${item.name}`}
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
                aria-label={`Eliminar ${item.name}`}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canEdit, canDelete, openEditModal, deleteDialog],
  )

  // ---------------------------------------------------------------------------
  // Branch guard
  // ---------------------------------------------------------------------------
  if (!selectedBranchId) {
    return (
      <PageContainer
        title="Sectores"
        description="Selecciona una sucursal para ver sus sectores"
        helpContent={helpContent.sectors}
      >
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)] mb-4">
            Selecciona una sucursal desde el Dashboard para ver sus sectores
          </p>
          <Button onClick={() => navigate('/')}>Ir al Dashboard</Button>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title="Sectores"
      description="Gestiona los sectores de la sucursal seleccionada."
      helpContent={helpContent.sectors}
      actions={
        canCreate ? (
          <Button onClick={() => modal.openCreate({ branch_id: selectedBranchId, name: '', is_active: true })}>
            Nuevo Sector
          </Button>
        ) : undefined
      }
    >
      <Card>
        {isLoading ? (
          <TableSkeleton rows={5} columns={3} />
        ) : (
          <Table
            columns={columns}
            items={paginatedItems}
            rowKey={(item) => item.id}
            emptyMessage="No hay sectores. Crea el primero con el boton superior."
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
        title={modal.selectedItem ? 'Editar Sector' : 'Nuevo Sector'}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>Cancelar</Button>
            <Button type="submit" form="sector-form" isLoading={isPending}>
              {modal.selectedItem ? 'Guardar' : 'Crear'}
            </Button>
          </>
        }
      >
        <form id="sector-form" action={formAction} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Sector"
              size="sm"
              content={
                <div className="space-y-3">
                  <p><strong>Completa los campos</strong> para crear o editar un sector:</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Nombre:</strong> Identificador del area fisica (ej: Salon Principal, Terraza). Obligatorio.</li>
                    <li><strong>Estado:</strong> Desactiva el sector sin eliminarlo si esta temporalmente fuera de servicio.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda sobre el formulario</span>
          </div>

          <Input
            label="Nombre"
            name="name"
            placeholder="ej: Salon Principal"
            value={modal.formData.name}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={state.errors?.name}
            required
          />

          <Toggle
            label="Activo"
            name="is_active"
            checked={modal.formData.is_active}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
          />
        </form>
      </Modal>

      {/* Delete confirmation with cascade preview */}
      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={deleteDialog.close}
        onConfirm={handleDelete}
        title="Eliminar Sector"
        message={`¿Estas seguro de eliminar "${deleteDialog.item?.name}"?`}
        confirmLabel="Eliminar"
      >
        {cascadePreview && cascadePreview.totalItems > 0 && (
          <CascadePreviewList preview={cascadePreview} />
        )}
      </ConfirmDialog>
    </PageContainer>
  )
}
