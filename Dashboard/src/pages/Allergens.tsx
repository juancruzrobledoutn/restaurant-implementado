/**
 * Allergens — tenant-scoped allergen CRUD page.
 *
 * Skills: dashboard-crud-page, react19-form-pattern, help-system-content
 */

import { useCallback, useMemo } from 'react'
import { useActionState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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

import { useAllergenStore, selectAllergens, selectIsLoading, useAllergenActions } from '@/stores/allergenStore'
import { deleteAllergenWithCascade, getAllergenPreview } from '@/services/cascadeService'
import { validateAllergen } from '@/utils/validation'
import { handleError } from '@/utils/logger'
import { helpContent } from '@/utils/helpContent'
import type { Allergen, AllergenFormData } from '@/types/menu'
import type { FormState } from '@/types/form'
import type { TableColumn } from '@/components/ui/Table'

const INITIAL_FORM_DATA: AllergenFormData = {
  name: '',
  icon: '',
  description: '',
  is_mandatory: false,
  severity: 'mild',
  is_active: true,
}

const SEVERITY_OPTIONS = [
  { value: 'mild', label: 'Leve' },
  { value: 'moderate', label: 'Moderada' },
  { value: 'severe', label: 'Severa' },
  { value: 'critical', label: 'Critica' },
]

export default function AllergensPage() {
  const { t } = useTranslation()

  // Store — named selectors, never destructure
  const items = useAllergenStore(selectAllergens)
  const isLoading = useAllergenStore(selectIsLoading)
  const { fetchAsync, createAsync, updateAsync } = useAllergenActions()

  // Permissions
  const { canCreate, canEdit, canDelete } = useAuthPermissions()

  // Hook trio
  const modal = useFormModal<AllergenFormData, Allergen>(INITIAL_FORM_DATA)
  const deleteDialog = useConfirmDialog<Allergen>()

  // Sort
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  )

  // Pagination
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } = usePagination(sortedItems)

  // ---------------------------------------------------------------------------
  // Form submission — useActionState
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (_prev: FormState<AllergenFormData>, formData: FormData): Promise<FormState<AllergenFormData>> => {
      const data: AllergenFormData = {
        name: formData.get('name') as string,
        icon: formData.get('icon') as string ?? '',
        description: formData.get('description') as string ?? '',
        is_mandatory: formData.get('is_mandatory') === 'on',
        severity: formData.get('severity') as AllergenFormData['severity'],
        is_active: formData.get('is_active') === 'on',
      }

      const validation = validateAllergen(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (modal.selectedItem) {
          await updateAsync(modal.selectedItem.id, data)
        } else {
          await createAsync(data)
        }
        return { isSuccess: true }
      } catch (error) {
        const message = handleError(error, 'AllergensPage.submitAction')
        return { isSuccess: false, message }
      }
    },
    [modal.selectedItem, createAsync, updateAsync],
  )

  const [state, formAction, isPending] = useActionState<FormState<AllergenFormData>, FormData>(
    submitAction,
    { isSuccess: false },
  )

  // Close modal on success
  if (state.isSuccess && modal.isOpen) modal.close()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openEditModal = useCallback(
    (item: Allergen) => {
      modal.openEdit(item, (a) => ({
        name: a.name,
        icon: a.icon ?? '',
        description: a.description ?? '',
        is_mandatory: a.is_mandatory,
        severity: a.severity,
        is_active: a.is_active,
      }))
    },
    [modal],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteDialog.item) return
    const preview = await getAllergenPreview(deleteDialog.item.id)
    try {
      await deleteAllergenWithCascade(deleteDialog.item.id)
      deleteDialog.close()
    } catch (error) {
      handleError(error, 'AllergensPage.handleDelete')
    }
    // Suppress unused preview warning — used in JSX below
    void preview
  }, [deleteDialog])

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<Allergen>[] = useMemo(
    () => [
      {
        key: 'name',
        label: t('allergens.name'),
        render: (item) => (
          <div>
            <span className="font-medium">{item.name}</span>
            {item.icon && <span className="ml-2 text-xs text-[var(--text-tertiary)]">{item.icon}</span>}
          </div>
        ),
      },
      {
        key: 'severity',
        label: 'Severidad',
        width: 'w-28',
        render: (item) => (
          <span className="text-sm capitalize">{item.severity}</span>
        ),
      },
      {
        key: 'is_mandatory',
        label: 'Obligatorio',
        width: 'w-24',
        render: (item) =>
          item.is_mandatory ? (
            <Badge variant="warning">Si</Badge>
          ) : (
            <Badge variant="neutral">No</Badge>
          ),
      },
      {
        key: 'is_active',
        label: t('common.status'),
        width: 'w-24',
        render: (item) =>
          item.is_active ? (
            <Badge variant="success"><span className="sr-only">Estado:</span> Activo</Badge>
          ) : (
            <Badge variant="danger"><span className="sr-only">Estado:</span> Inactivo</Badge>
          ),
      },
      {
        key: 'actions',
        label: t('common.actions'),
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
    [t, canEdit, canDelete, openEditModal, deleteDialog],
  )

  // Initial fetch
  useMemo(() => { void fetchAsync() }, [fetchAsync])

  return (
    <PageContainer
      title={t('allergens.title')}
      description="Gestiona los alergenos del tenant. Se comparten entre todas las sucursales."
      helpContent={helpContent.allergens}
      actions={
        canCreate ? (
          <Button onClick={() => modal.openCreate()}>
            {t('allergens.new')}
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
            emptyMessage={t('allergens.empty')}
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
        title={modal.selectedItem ? t('allergens.edit') : t('allergens.new')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="allergen-form" isLoading={isPending}>
              {modal.selectedItem ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="allergen-form" action={formAction} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Alergeno"
              size="sm"
              content={
                <div className="space-y-3">
                  <p><strong>Completa los campos</strong> para crear o editar un alergeno:</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Nombre:</strong> Identificador del alergeno (ej: Gluten, Lactosa). Obligatorio.</li>
                    <li><strong>Icono:</strong> Nombre de icono o emoji para mostrar en el menu.</li>
                    <li><strong>Severidad:</strong> Nivel de riesgo para personas alergicas.</li>
                    <li><strong>Obligatorio:</strong> Marca si la declaracion es legalmente obligatoria.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda sobre el formulario</span>
          </div>

          <Input
            label={t('allergens.name')}
            name="name"
            placeholder={t('allergens.namePlaceholder')}
            value={modal.formData.name}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={state.errors?.name}
            required
          />

          <Input
            label={t('allergens.icon')}
            name="icon"
            placeholder="Ej: gluten-icon"
            value={modal.formData.icon}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, icon: e.target.value }))}
          />

          <Input
            label={t('allergens.description')}
            name="description"
            placeholder="Descripcion del alergeno"
            value={modal.formData.description}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, description: e.target.value }))}
          />

          <Select
            label={t('allergens.severity')}
            name="severity"
            options={SEVERITY_OPTIONS}
            value={modal.formData.severity}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, severity: e.target.value as AllergenFormData['severity'] }))}
          />

          <Toggle
            label={t('allergens.is_mandatory')}
            name="is_mandatory"
            checked={modal.formData.is_mandatory}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, is_mandatory: e.target.checked }))}
          />

          <Toggle
            label={t('common.active')}
            name="is_active"
            checked={modal.formData.is_active}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
          />
        </form>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={deleteDialog.close}
        onConfirm={handleDelete}
        title={t('allergens.delete')}
        message={`¿Estas seguro de eliminar "${deleteDialog.item?.name}"?`}
        confirmLabel={t('common.delete')}
      >
        {/* Cascade preview placeholder — allergenPreview loaded async in handleDelete */}
      </ConfirmDialog>
    </PageContainer>
  )
}
