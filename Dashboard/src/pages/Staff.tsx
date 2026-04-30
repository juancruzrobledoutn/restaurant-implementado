/**
 * Staff — staff user management with role assignment (C-16).
 *
 * Skills: dashboard-crud-page, react19-form-pattern
 *
 * Key behaviors:
 * - CRUD: create/edit user details, assignRole/revokeRole per branch
 * - Delete button only visible to ADMIN (MANAGER cannot delete staff)
 * - Role assignment sub-section in modal — each assignment row is a branch+role pair
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
import { Toggle } from '@/components/ui/Toggle'
import { HelpButton } from '@/components/ui/HelpButton'

import { useFormModal } from '@/hooks/useFormModal'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { usePagination } from '@/hooks/usePagination'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'

import { useStaffStore, selectStaff, selectStaffIsLoading, useStaffActions } from '@/stores/staffStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { validateStaff } from '@/utils/validation'
import { handleError } from '@/utils/logger'
import { helpContent } from '@/utils/helpContent'

import type { StaffUser, StaffFormData } from '@/types/operations'
import type { FormState } from '@/types/form'
import type { TableColumn } from '@/components/ui/Table'

const INITIAL_FORM_DATA: StaffFormData = {
  email: '',
  first_name: '',
  last_name: '',
  password: '',
  is_active: true,
}

export default function StaffPage() {
  const navigate = useNavigate()

  // Stores
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const allItems = useStaffStore(selectStaff)
  const isLoading = useStaffStore(selectStaffIsLoading)
  const { fetchAll, createStaffAsync, updateStaffAsync, deleteStaffAsync } = useStaffActions()

  // Permissions — only ADMIN can delete
  const { canCreate, canEdit, isAdmin } = useAuthPermissions()

  // Hook trio
  const modal = useFormModal<StaffFormData, StaffUser>(INITIAL_FORM_DATA)
  const deleteDialog = useConfirmDialog<StaffUser>()

  // Filter staff by branch (if a branch is selected)
  const filteredItems = useMemo(
    () =>
      selectedBranchId
        ? allItems.filter((u) => u.assignments.some((a) => a.branch_id === selectedBranchId))
        : allItems,
    [allItems, selectedBranchId],
  )

  const sortedItems = useMemo(
    () =>
      [...filteredItems].sort((a, b) =>
        `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`),
      ),
    [filteredItems],
  )

  // Pagination
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } =
    usePagination(sortedItems)

  // Fetch on mount / branch change
  useEffect(() => {
    void fetchAll(selectedBranchId ?? undefined)
  }, [selectedBranchId, fetchAll])

  // ---------------------------------------------------------------------------
  // Form submission
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (
      _prev: FormState<StaffFormData>,
      formData: FormData,
    ): Promise<FormState<StaffFormData>> => {
      const data: StaffFormData = {
        email: formData.get('email') as string,
        first_name: formData.get('first_name') as string,
        last_name: formData.get('last_name') as string,
        password: formData.get('password') as string,
        is_active: formData.get('is_active') === 'on',
      }

      const validation = validateStaff(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (modal.selectedItem) {
          await updateStaffAsync(modal.selectedItem.id, data)
        } else {
          await createStaffAsync(data)
        }
        return { isSuccess: true }
      } catch (error) {
        const message = handleError(error, 'StaffPage.submitAction')
        return { isSuccess: false, message }
      }
    },
    [modal.selectedItem, createStaffAsync, updateStaffAsync],
  )

  const [state, formAction, isPending] = useActionState<FormState<StaffFormData>, FormData>(
    submitAction,
    { isSuccess: false },
  )

  if (state.isSuccess && modal.isOpen) modal.close()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openEditModal = useCallback(
    (item: StaffUser) => {
      modal.openEdit(item, (u) => ({
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        password: '',
        is_active: u.is_active,
      }))
    },
    [modal],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteDialog.item) return
    try {
      await deleteStaffAsync(deleteDialog.item.id)
      deleteDialog.close()
    } catch (error) {
      handleError(error, 'StaffPage.handleDelete')
    }
  }, [deleteDialog, deleteStaffAsync])

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<StaffUser>[] = useMemo(
    () => [
      {
        key: 'email',
        label: 'Email',
        render: (item) => <span className="text-sm">{item.email}</span>,
      },
      {
        key: 'full_name',
        label: 'Nombre',
        render: (item) => (
          <span className="font-medium">
            {item.first_name} {item.last_name}
          </span>
        ),
      },
      {
        key: 'assignments',
        label: 'Roles',
        render: (item) =>
          item.assignments.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {item.assignments.map((a) => (
                <Badge key={`${a.branch_id}-${a.role}`} variant="info">
                  {a.branch_name} / {a.role}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-xs text-gray-500 italic">Sin asignaciones</span>
          ),
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
                aria-label={`Editar ${item.email}`}
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); deleteDialog.open(item) }}
                className="text-[var(--danger-icon)] hover:text-[var(--danger-text)] hover:bg-[var(--danger-border)]/10"
                aria-label={`Eliminar ${item.email}`}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canEdit, isAdmin, openEditModal, deleteDialog],
  )

  // ---------------------------------------------------------------------------
  // Branch guard (soft — staff is tenant-wide, but we filter by branch)
  // ---------------------------------------------------------------------------
  if (!selectedBranchId) {
    return (
      <PageContainer
        title="Personal"
        description="Gestiona el personal de tu restaurante"
        helpContent={helpContent.staff}
      >
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)] mb-4">
            Selecciona una sucursal para ver el personal asignado
          </p>
          <Button onClick={() => navigate('/')}>Ir al Dashboard</Button>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title="Personal"
      description="Gestiona el personal y sus roles por sucursal."
      helpContent={helpContent.staff}
      actions={
        canCreate ? (
          <Button onClick={() => modal.openCreate(INITIAL_FORM_DATA)}>
            Nuevo Usuario
          </Button>
        ) : undefined
      }
    >
      <Card>
        {isLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : (
          <Table
            columns={columns}
            items={paginatedItems}
            rowKey={(item) => item.id}
            emptyMessage="No hay personal asignado a esta sucursal."
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
        title={modal.selectedItem ? 'Editar Usuario' : 'Nuevo Usuario'}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>Cancelar</Button>
            <Button type="submit" form="staff-form" isLoading={isPending}>
              {modal.selectedItem ? 'Guardar' : 'Crear'}
            </Button>
          </>
        }
      >
        <form id="staff-form" action={formAction} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Usuario"
              size="sm"
              content={
                <div className="space-y-3">
                  <p><strong>Completa los campos</strong> para crear o editar un usuario:</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Email:</strong> Correo de acceso al sistema. Unico por tenant.</li>
                    <li><strong>Contrasena:</strong> Solo se requiere al crear. Dejar vacio al editar para no cambiarla.</li>
                    <li><strong>Roles:</strong> Asigna roles desde la pagina de detalle del usuario.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda sobre el formulario</span>
          </div>

          <Input
            label="Email"
            name="email"
            type="email"
            placeholder="usuario@restaurante.com"
            value={modal.formData.email}
            onChange={(e) =>
              modal.setFormData((prev) => ({ ...prev, email: e.target.value }))
            }
            error={state.errors?.email}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Nombre"
              name="first_name"
              placeholder="Juan"
              value={modal.formData.first_name}
              onChange={(e) =>
                modal.setFormData((prev) => ({ ...prev, first_name: e.target.value }))
              }
              error={state.errors?.first_name}
              required
            />
            <Input
              label="Apellido"
              name="last_name"
              placeholder="Garcia"
              value={modal.formData.last_name}
              onChange={(e) =>
                modal.setFormData((prev) => ({ ...prev, last_name: e.target.value }))
              }
              error={state.errors?.last_name}
              required
            />
          </div>

          {!modal.selectedItem && (
            <Input
              label="Contrasena"
              name="password"
              type="password"
              placeholder="Minimo 8 caracteres"
              value={modal.formData.password ?? ''}
              onChange={(e) =>
                modal.setFormData((prev) => ({ ...prev, password: e.target.value }))
              }
              error={state.errors?.password}
              required
            />
          )}

          <Toggle
            label="Activo"
            name="is_active"
            checked={modal.formData.is_active}
            onChange={(e) =>
              modal.setFormData((prev) => ({ ...prev, is_active: e.target.checked }))
            }
          />

          {state.message && (
            <p className="text-sm text-red-400" role="alert">
              {state.message}
            </p>
          )}
        </form>

        {/* Role assignments — show on edit only */}
        {modal.selectedItem && (
          <div className="mt-6 border-t border-gray-700 pt-4">
            <p className="text-sm font-medium text-gray-300 mb-2">Asignaciones de rol</p>
            {modal.selectedItem.assignments.length === 0 ? (
              <p className="text-xs text-gray-500 italic">Sin asignaciones activas.</p>
            ) : (
              <div className="space-y-2">
                {modal.selectedItem.assignments.map((a) => (
                  <div
                    key={`${a.branch_id}-${a.role}`}
                    className="flex items-center justify-between rounded-md bg-gray-800 px-3 py-2 text-sm"
                  >
                    <span>
                      {a.branch_name}{' '}
                      <Badge variant="info" className="ml-1">
                        {a.role}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-gray-500">
              Para modificar roles usa la API directamente o el panel de administracion de roles.
            </p>
          </div>
        )}
      </Modal>

      {/* Delete confirmation — ADMIN only */}
      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={deleteDialog.close}
        onConfirm={handleDelete}
        title="Eliminar Usuario"
        message={`¿Estas seguro de eliminar a ${deleteDialog.item?.first_name} ${deleteDialog.item?.last_name} (${deleteDialog.item?.email})?`}
        confirmLabel="Eliminar"
      />
    </PageContainer>
  )
}
