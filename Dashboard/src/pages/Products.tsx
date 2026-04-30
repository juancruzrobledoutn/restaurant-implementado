/**
 * Products — branch-scoped product CRUD page.
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
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { HelpButton } from '@/components/ui/HelpButton'

import { useFormModal } from '@/hooks/useFormModal'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { usePagination } from '@/hooks/usePagination'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'

import { useProductStore, selectProducts, selectProductIsLoading, useProductActions } from '@/stores/productStore'
import { useSubcategoryStore, selectSubcategories } from '@/stores/subcategoryStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'
import { validateProduct } from '@/utils/validation'
import { formatPrice } from '@/utils/formatters'
import { handleError } from '@/utils/logger'
import { helpContent } from '@/utils/helpContent'
import type { Product, ProductFormData } from '@/types/menu'
import type { FormState } from '@/types/form'
import type { TableColumn } from '@/components/ui/Table'

const INITIAL_FORM_DATA: ProductFormData = {
  name: '',
  description: '',
  price_cents: 0,
  image: '',
  featured: false,
  popular: false,
  is_active: true,
  subcategory_id: '',
  branch_id: '',
}

export default function ProductsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const selectedBranchId = useBranchStore(selectSelectedBranchId)

  // Stores
  const allProducts = useProductStore(selectProducts)
  const isLoading = useProductStore(selectProductIsLoading)
  const { fetchAsync, createAsync, updateAsync, deleteAsync } = useProductActions()

  const allSubcategories = useSubcategoryStore(selectSubcategories)

  // Permissions
  const { canCreate, canEdit, canDelete } = useAuthPermissions()

  // Hook trio
  const modal = useFormModal<ProductFormData, Product>(INITIAL_FORM_DATA)
  const deleteDialog = useConfirmDialog<Product>()

  // Filter by branch
  const filteredProducts = useMemo(
    () => (selectedBranchId ? allProducts.filter((p) => p.branch_id === selectedBranchId) : []),
    [allProducts, selectedBranchId],
  )

  const branchSubcategories = useMemo(
    () => (selectedBranchId ? allSubcategories.filter((sc) => sc.branch_id === selectedBranchId) : []),
    [allSubcategories, selectedBranchId],
  )

  const subcategoryOptions = useMemo(
    () => branchSubcategories.map((sc) => ({ value: sc.id, label: sc.name })),
    [branchSubcategories],
  )

  // Sort
  const sortedItems = useMemo(
    () => [...filteredProducts].sort((a, b) => a.name.localeCompare(b.name)),
    [filteredProducts],
  )

  // Pagination
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } = usePagination(sortedItems)

  // Fetch on branch change
  useEffect(() => {
    if (selectedBranchId) void fetchAsync()
  }, [selectedBranchId, fetchAsync])

  // ---------------------------------------------------------------------------
  // Form submission
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (_prev: FormState<ProductFormData>, formData: FormData): Promise<FormState<ProductFormData>> => {
      const priceStr = formData.get('price_cents') as string
      const data: ProductFormData = {
        name: formData.get('name') as string,
        description: formData.get('description') as string ?? '',
        price_cents: Math.round(parseFloat(priceStr || '0') * 100),
        image: formData.get('image') as string ?? '',
        featured: formData.get('featured') === 'on',
        popular: formData.get('popular') === 'on',
        is_active: formData.get('is_active') === 'on',
        subcategory_id: formData.get('subcategory_id') as string,
        branch_id: selectedBranchId ?? '',
      }

      const validation = validateProduct(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (modal.selectedItem) {
          await updateAsync(modal.selectedItem.id, data)
        } else {
          await createAsync(data)
        }
        return { isSuccess: true }
      } catch (error) {
        const message = handleError(error, 'ProductsPage.submitAction')
        return { isSuccess: false, message }
      }
    },
    [modal.selectedItem, createAsync, updateAsync, selectedBranchId],
  )

  const [state, formAction, isPending] = useActionState<FormState<ProductFormData>, FormData>(
    submitAction,
    { isSuccess: false },
  )

  if (state.isSuccess && modal.isOpen) modal.close()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openEditModal = useCallback(
    (item: Product) => {
      modal.openEdit(item, (p) => ({
        name: p.name,
        description: p.description,
        price_cents: p.price_cents,
        image: p.image ?? '',
        featured: p.featured,
        popular: p.popular,
        is_active: p.is_active,
        subcategory_id: p.subcategory_id,
        branch_id: p.branch_id,
      }))
    },
    [modal],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteDialog.item) return
    try {
      await deleteAsync(deleteDialog.item.id)
      deleteDialog.close()
    } catch (error) {
      handleError(error, 'ProductsPage.handleDelete')
    }
  }, [deleteDialog, deleteAsync])

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<Product>[] = useMemo(
    () => [
      {
        key: 'name',
        label: t('products.name'),
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
        key: 'price_cents',
        label: t('products.price'),
        width: 'w-28',
        render: (item) => <span className="text-sm font-mono">{formatPrice(item.price_cents)}</span>,
      },
      {
        key: 'subcategory_id',
        label: t('products.subcategory'),
        width: 'w-36',
        render: (item) => {
          const sc = allSubcategories.find((s) => s.id === item.subcategory_id)
          return <span className="text-sm">{sc?.name ?? item.subcategory_id}</span>
        },
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
    [t, canEdit, canDelete, openEditModal, deleteDialog, allSubcategories],
  )

  // Branch guard
  if (!selectedBranchId) {
    return (
      <PageContainer
        title={t('products.title')}
        description="Selecciona una sucursal para ver sus productos"
        helpContent={helpContent.products}
      >
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)] mb-4">
            Selecciona una sucursal desde el Dashboard para ver sus productos
          </p>
          <Button onClick={() => navigate('/')}>Ir al Dashboard</Button>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title={t('products.title')}
      description="Gestiona los productos del menu de la sucursal seleccionada."
      helpContent={helpContent.products}
      actions={
        canCreate ? (
          <Button onClick={() => modal.openCreate({ branch_id: selectedBranchId })}>
            {t('products.new')}
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
            emptyMessage={t('products.empty')}
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
        title={modal.selectedItem ? t('products.edit') : t('products.new')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>{t('common.cancel')}</Button>
            <Button type="submit" form="product-form" isLoading={isPending}>
              {modal.selectedItem ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="product-form" action={formAction} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Producto"
              size="sm"
              content={
                <div className="space-y-3">
                  <p><strong>Completa los campos</strong> para crear o editar un producto:</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Nombre:</strong> Nombre del producto en el menu. Obligatorio.</li>
                    <li><strong>Precio:</strong> Precio en pesos (ej: 12.50). Obligatorio, mayor a 0.</li>
                    <li><strong>Subcategoria:</strong> Subcategoria a la que pertenece. Obligatorio.</li>
                    <li><strong>Destacado / Popular:</strong> Para resaltar en el menu digital.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda sobre el formulario</span>
          </div>

          <Input
            label={t('products.name')}
            name="name"
            placeholder={t('products.namePlaceholder')}
            value={modal.formData.name}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={state.errors?.name}
            required
          />

          <Input
            label={t('products.description')}
            name="description"
            placeholder="Descripcion del producto"
            value={modal.formData.description}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, description: e.target.value }))}
          />

          <Input
            label={`${t('products.price')} ($)`}
            name="price_cents"
            type="number"
            placeholder="0.00"
            value={String(modal.formData.price_cents / 100)}
            onChange={(e) => modal.setFormData((prev) => ({
              ...prev,
              price_cents: Math.round(parseFloat(e.target.value || '0') * 100),
            }))}
            error={state.errors?.price_cents}
            required
          />

          <Select
            label={t('products.subcategory')}
            name="subcategory_id"
            options={subcategoryOptions}
            value={modal.formData.subcategory_id}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, subcategory_id: e.target.value }))}
            placeholder="Selecciona una subcategoria"
          />
          {state.errors?.subcategory_id && (
            <span className="text-red-400 text-sm">{state.errors.subcategory_id}</span>
          )}

          <Input
            label={t('products.image')}
            name="image"
            placeholder="https://example.com/image.jpg"
            value={modal.formData.image}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, image: e.target.value }))}
            error={state.errors?.image}
          />

          <div className="grid grid-cols-3 gap-4">
            <Toggle
              label="Destacado"
              name="featured"
              checked={modal.formData.featured}
              onChange={(e) => modal.setFormData((prev) => ({ ...prev, featured: e.target.checked }))}
            />
            <Toggle
              label="Popular"
              name="popular"
              checked={modal.formData.popular}
              onChange={(e) => modal.setFormData((prev) => ({ ...prev, popular: e.target.checked }))}
            />
            <Toggle
              label={t('common.active')}
              name="is_active"
              checked={modal.formData.is_active}
              onChange={(e) => modal.setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
            />
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={deleteDialog.close}
        onConfirm={handleDelete}
        title={t('products.delete')}
        message={`¿Estas seguro de eliminar "${deleteDialog.item?.name}"?`}
        confirmLabel={t('common.delete')}
      />
    </PageContainer>
  )
}
