/**
 * Categories — branch-scoped category CRUD page.
 *
 * Skills: dashboard-crud-page, react19-form-pattern, help-system-content
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useActionState } from 'react'
import { useNavigate } from 'react-router'
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
import { Toggle } from '@/components/ui/Toggle'
import { HelpButton } from '@/components/ui/HelpButton'
import { CascadePreviewList } from '@/components/ui/CascadePreviewList'

import { useFormModal } from '@/hooks/useFormModal'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { usePagination } from '@/hooks/usePagination'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'

import { useCategoryStore, selectCategories, selectCategoryIsLoading, useCategoryActions } from '@/stores/categoryStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { deleteCategoryWithCascade, getCategoryPreview } from '@/services/cascadeService'
import { validateCategory } from '@/utils/validation'
import { handleError } from '@/utils/logger'
import { helpContent } from '@/utils/helpContent'

import type { Category, CategoryFormData, CascadePreview } from '@/types/menu'
import type { FormState } from '@/types/form'
import type { TableColumn } from '@/components/ui/Table'
import { useState } from 'react'

const INITIAL_FORM_DATA: CategoryFormData = {
  name: '',
  order: 0,
  icon: '',
  image: '',
  is_active: true,
  branch_id: '',
}

export default function CategoriesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Store
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const allItems = useCategoryStore(selectCategories)
  const isLoading = useCategoryStore(selectCategoryIsLoading)
  const { fetchAsync, createAsync, updateAsync } = useCategoryActions()

  // Permissions
  const { canCreate, canEdit, canDelete } = useAuthPermissions()

  // Hook trio
  const modal = useFormModal<CategoryFormData, Category>(INITIAL_FORM_DATA)
  const deleteDialog = useConfirmDialog<Category>()

  // Branch guard
  const filteredItems = useMemo(
    () => (selectedBranchId ? allItems.filter((c) => c.branch_id === selectedBranchId) : []),
    [allItems, selectedBranchId],
  )

  // Sort
  const sortedItems = useMemo(
    () => [...filteredItems].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [filteredItems],
  )

  // Pagination
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } = usePagination(sortedItems)

  // Cascade preview state
  const [cascadePreview, setCascadePreview] = useState<CascadePreview | null>(null)

  // Fetch on branch change
  useEffect(() => {
    if (selectedBranchId) void fetchAsync()
  }, [selectedBranchId, fetchAsync])

  // ---------------------------------------------------------------------------
  // Form submission
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (_prev: FormState<CategoryFormData>, formData: FormData): Promise<FormState<CategoryFormData>> => {
      const data: CategoryFormData = {
        name: formData.get('name') as string,
        order: parseInt(formData.get('order') as string, 10) || 0,
        icon: formData.get('icon') as string ?? '',
        image: formData.get('image') as string ?? '',
        is_active: formData.get('is_active') === 'on',
        branch_id: selectedBranchId ?? '',
      }

      const validation = validateCategory(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (modal.selectedItem) {
          await updateAsync(modal.selectedItem.id, data)
        } else {
          await createAsync(data)
        }
        return { isSuccess: true }
      } catch (error) {
        const message = handleError(error, 'CategoriesPage.submitAction')
        return { isSuccess: false, message }
      }
    },
    [modal.selectedItem, createAsync, updateAsync, selectedBranchId],
  )

  const [state, formAction, isPending] = useActionState<FormState<CategoryFormData>, FormData>(
    submitAction,
    { isSuccess: false },
  )

  if (state.isSuccess && modal.isOpen) modal.close()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openEditModal = useCallback(
    (item: Category) => {
      modal.openEdit(item, (c) => ({
        name: c.name,
        order: c.order,
        icon: c.icon ?? '',
        image: c.image ?? '',
        is_active: c.is_active,
        branch_id: c.branch_id,
      }))
    },
    [modal],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteDialog.item) return
    try {
      await deleteCategoryWithCascade(deleteDialog.item.id)
      deleteDialog.close()
      setCascadePreview(null)
    } catch (error) {
      handleError(error, 'CategoriesPage.handleDelete')
    }
  }, [deleteDialog])

  // Load cascade preview when delete dialog opens
  useEffect(() => {
    if (deleteDialog.isOpen && deleteDialog.item) {
      getCategoryPreview(deleteDialog.item.id).then(setCascadePreview).catch(() => setCascadePreview(null))
    } else {
      void Promise.resolve().then(() => setCascadePreview(null))
    }
  }, [deleteDialog.isOpen, deleteDialog.item])

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<Category>[] = useMemo(
    () => [
      {
        key: 'name',
        label: t('categories.name'),
        render: (item) => (
          <div className="flex items-center gap-2">
            {item.icon && <span aria-hidden="true">{item.icon}</span>}
            <span className="font-medium">{item.name}</span>
            {item._optimistic && (
              <span className="text-xs text-[var(--text-tertiary)] italic">guardando...</span>
            )}
          </div>
        ),
      },
      {
        key: 'order',
        label: 'Orden',
        width: 'w-20',
        render: (item) => <span className="text-sm">{item.order}</span>,
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

  // ---------------------------------------------------------------------------
  // Branch guard
  // ---------------------------------------------------------------------------
  if (!selectedBranchId) {
    return (
      <PageContainer
        title={t('categories.title')}
        description="Selecciona una sucursal para ver sus categorias"
        helpContent={helpContent.categories}
      >
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)] mb-4">
            Selecciona una sucursal desde el Dashboard para ver sus categorias
          </p>
          <Button onClick={() => navigate('/')}>Ir al Dashboard</Button>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title={t('categories.title')}
      description="Gestiona las categorias del menu de la sucursal seleccionada."
      helpContent={helpContent.categories}
      actions={
        canCreate ? (
          <Button onClick={() => modal.openCreate({ branch_id: selectedBranchId })}>
            {t('categories.new')}
          </Button>
        ) : undefined
      }
    >
      <Card>
        {isLoading ? (
          <TableSkeleton rows={5} columns={4} />
        ) : (
          <Table
            columns={columns}
            items={paginatedItems}
            rowKey={(item) => item.id}
            emptyMessage={t('categories.empty')}
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
        title={modal.selectedItem ? t('categories.edit') : t('categories.new')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>{t('common.cancel')}</Button>
            <Button type="submit" form="category-form" isLoading={isPending}>
              {modal.selectedItem ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="category-form" action={formAction} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Categoria"
              size="sm"
              content={
                <div className="space-y-3">
                  <p><strong>Completa los campos</strong> para crear o editar una categoria:</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Nombre:</strong> Nombre visible en el menu (ej: Bebidas). Obligatorio.</li>
                    <li><strong>Orden:</strong> Posicion en el menu (numeros menores aparecen primero).</li>
                    <li><strong>Icono:</strong> Emoji o nombre de icono para representar la categoria.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda sobre el formulario</span>
          </div>

          <Input
            label={t('categories.name')}
            name="name"
            placeholder={t('categories.namePlaceholder')}
            value={modal.formData.name}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={state.errors?.name}
            required
          />

          <Input
            label="Orden"
            name="order"
            type="number"
            value={String(modal.formData.order)}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, order: parseInt(e.target.value, 10) || 0 }))}
          />

          <Input
            label="Icono"
            name="icon"
            placeholder="🍔 o nombre de icono"
            value={modal.formData.icon}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, icon: e.target.value }))}
          />

          <Input
            label={t('categories.image')}
            name="image"
            placeholder="https://example.com/image.jpg"
            value={modal.formData.image}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, image: e.target.value }))}
            error={state.errors?.image}
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
        title={t('categories.delete')}
        message={`¿Estas seguro de eliminar "${deleteDialog.item?.name}"?`}
        confirmLabel={t('common.delete')}
      >
        {cascadePreview && cascadePreview.totalItems > 0 && (
          <CascadePreviewList preview={cascadePreview} />
        )}
      </ConfirmDialog>
    </PageContainer>
  )
}
