/**
 * Subcategories — branch-scoped subcategory CRUD page.
 *
 * Skills: dashboard-crud-page, react19-form-pattern, help-system-content
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useActionState } from 'react'
import { useNavigate } from 'react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'

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
import { CascadePreviewList } from '@/components/ui/CascadePreviewList'

import { useFormModal } from '@/hooks/useFormModal'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { usePagination } from '@/hooks/usePagination'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'

import { useSubcategoryStore, selectSubcategories } from '@/stores/subcategoryStore'
import { useCategoryStore, selectCategories } from '@/stores/categoryStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { deleteSubcategoryWithCascade, getSubcategoryPreview } from '@/services/cascadeService'
import { validateSubcategory } from '@/utils/validation'
import { handleError } from '@/utils/logger'
import { helpContent } from '@/utils/helpContent'
import type { Subcategory, SubcategoryFormData, CascadePreview } from '@/types/menu'
import type { FormState } from '@/types/form'
import type { TableColumn } from '@/components/ui/Table'

const INITIAL_FORM_DATA: SubcategoryFormData = {
  name: '',
  order: 0,
  image: '',
  is_active: true,
  category_id: '',
  branch_id: '',
}

export default function SubcategoriesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const selectedBranchId = useBranchStore(selectSelectedBranchId)

  // Stores
  const allSubcategories = useSubcategoryStore(selectSubcategories)
  const isLoading = useSubcategoryStore((s) => s.isLoading)
  const subcategoryActions = useSubcategoryStore(
    useShallow((s) => ({
      fetchAsync: s.fetchAsync,
      createAsync: s.createAsync,
      updateAsync: s.updateAsync,
      deleteAsync: s.deleteAsync,
    })),
  )

  const allCategories = useCategoryStore(selectCategories)

  // Permissions
  const { canCreate, canEdit, canDelete } = useAuthPermissions()

  // Hook trio
  const modal = useFormModal<SubcategoryFormData, Subcategory>(INITIAL_FORM_DATA)
  const deleteDialog = useConfirmDialog<Subcategory>()

  // Filter by branch
  const filteredSubcategories = useMemo(
    () => (selectedBranchId ? allSubcategories.filter((sc) => sc.branch_id === selectedBranchId) : []),
    [allSubcategories, selectedBranchId],
  )

  const branchCategories = useMemo(
    () => (selectedBranchId ? allCategories.filter((c) => c.branch_id === selectedBranchId) : []),
    [allCategories, selectedBranchId],
  )

  const categoryOptions = useMemo(
    () => branchCategories.map((c) => ({ value: c.id, label: c.name })),
    [branchCategories],
  )

  // Sort
  const sortedItems = useMemo(
    () => [...filteredSubcategories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [filteredSubcategories],
  )

  // Pagination
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } = usePagination(sortedItems)

  // Cascade preview
  const [cascadePreview, setCascadePreview] = useState<CascadePreview | null>(null)

  // Fetch on branch change — destructure to get stable function reference
  const { fetchAsync: fetchSubcategoriesAsync } = subcategoryActions
  useEffect(() => {
    if (selectedBranchId) {
      void fetchSubcategoriesAsync()
    }
  }, [selectedBranchId, fetchSubcategoriesAsync])

  // ---------------------------------------------------------------------------
  // Form submission
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (_prev: FormState<SubcategoryFormData>, formData: FormData): Promise<FormState<SubcategoryFormData>> => {
      const data: SubcategoryFormData = {
        name: formData.get('name') as string,
        order: parseInt(formData.get('order') as string, 10) || 0,
        image: formData.get('image') as string ?? '',
        is_active: formData.get('is_active') === 'on',
        category_id: formData.get('category_id') as string,
        branch_id: selectedBranchId ?? '',
      }

      const validation = validateSubcategory(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (modal.selectedItem) {
          await subcategoryActions.updateAsync(modal.selectedItem.id, data)
        } else {
          await subcategoryActions.createAsync(data)
        }
        return { isSuccess: true }
      } catch (error) {
        const message = handleError(error, 'SubcategoriesPage.submitAction')
        return { isSuccess: false, message }
      }
    },
    [modal.selectedItem, subcategoryActions, selectedBranchId],
  )

  const [state, formAction, isPending] = useActionState<FormState<SubcategoryFormData>, FormData>(
    submitAction,
    { isSuccess: false },
  )

  if (state.isSuccess && modal.isOpen) modal.close()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openEditModal = useCallback(
    (item: Subcategory) => {
      modal.openEdit(item, (sc) => ({
        name: sc.name,
        order: sc.order,
        image: sc.image ?? '',
        is_active: sc.is_active,
        category_id: sc.category_id,
        branch_id: sc.branch_id,
      }))
    },
    [modal],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteDialog.item) return
    try {
      await deleteSubcategoryWithCascade(deleteDialog.item.id)
      deleteDialog.close()
      setCascadePreview(null)
    } catch (error) {
      handleError(error, 'SubcategoriesPage.handleDelete')
    }
  }, [deleteDialog])

  useEffect(() => {
    if (deleteDialog.isOpen && deleteDialog.item) {
      getSubcategoryPreview(deleteDialog.item.id).then(setCascadePreview).catch(() => setCascadePreview(null))
    } else {
      void Promise.resolve().then(() => setCascadePreview(null))
    }
  }, [deleteDialog.isOpen, deleteDialog.item])

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<Subcategory>[] = useMemo(
    () => [
      {
        key: 'name',
        label: t('subcategories.name'),
        render: (item) => (
          <div>
            <span className="font-medium">{item.name}</span>
            {item._optimistic && (
              <span className="text-xs text-[var(--text-tertiary)] italic ml-2">guardando...</span>
            )}
          </div>
        ),
      },
      {
        key: 'category_id',
        label: t('subcategories.category'),
        width: 'w-36',
        render: (item) => {
          const cat = allCategories.find((c) => c.id === item.category_id)
          return <span className="text-sm">{cat?.name ?? item.category_id}</span>
        },
      },
      {
        key: 'order',
        label: t('subcategories.order'),
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
    [t, canEdit, canDelete, openEditModal, deleteDialog, allCategories],
  )

  // Branch guard
  if (!selectedBranchId) {
    return (
      <PageContainer
        title={t('subcategories.title')}
        description={t('subcategories.selectBranch')}
        helpContent={helpContent.subcategories}
      >
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)] mb-4">{t('subcategories.selectBranch')}</p>
          <Button onClick={() => navigate('/')}>Ir al Dashboard</Button>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title={t('subcategories.title')}
      description="Gestiona las subcategorias del menu de la sucursal seleccionada."
      helpContent={helpContent.subcategories}
      actions={
        canCreate ? (
          <Button onClick={() => modal.openCreate({ branch_id: selectedBranchId })}>
            {t('subcategories.new')}
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
            emptyMessage={t('subcategories.empty')}
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
        title={modal.selectedItem ? t('subcategories.edit') : t('subcategories.new')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>{t('common.cancel')}</Button>
            <Button type="submit" form="subcategory-form" isLoading={isPending}>
              {modal.selectedItem ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="subcategory-form" action={formAction} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Subcategoria"
              size="sm"
              content={
                <div className="space-y-3">
                  <p><strong>Completa los campos</strong> para crear o editar una subcategoria:</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Nombre:</strong> Nombre visible en el menu. Obligatorio.</li>
                    <li><strong>Categoria:</strong> Categoria padre a la que pertenece. Obligatorio.</li>
                    <li><strong>Orden:</strong> Posicion dentro de la categoria.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda sobre el formulario</span>
          </div>

          <Input
            label={t('subcategories.name')}
            name="name"
            placeholder={t('subcategories.namePlaceholder')}
            value={modal.formData.name}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={state.errors?.name}
            required
          />

          <Select
            label={t('subcategories.category')}
            name="category_id"
            options={categoryOptions}
            value={modal.formData.category_id}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, category_id: e.target.value }))}
            placeholder="Selecciona una categoria"
          />
          {state.errors?.category_id && (
            <span className="text-red-400 text-sm">{state.errors.category_id}</span>
          )}

          <Input
            label={t('subcategories.order')}
            name="order"
            type="number"
            value={String(modal.formData.order)}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, order: parseInt(e.target.value, 10) || 0 }))}
          />

          <Input
            label={t('subcategories.image')}
            name="image"
            placeholder="https://example.com/image.jpg"
            value={modal.formData.image}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, image: e.target.value }))}
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
        title={t('subcategories.delete')}
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
