/**
 * Promotions — tenant-scoped promotion CRUD page.
 *
 * Design: design.md D1–D12
 * Spec: specs/dashboard-promotions-page/spec.md
 * Skills: dashboard-crud-page, react19-form-pattern, help-system-content,
 *         zustand-store-pattern, ws-frontend-subscription
 *
 * RBAC:
 *   ADMIN  → full access (create, edit, toggle, delete)
 *   MANAGER → create, edit, toggle (delete button hidden)
 *   KITCHEN / WAITER → forbidden (redirect to /)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useActionState } from 'react'
import { Navigate } from 'react-router'
import { Pencil, Trash2, X } from 'lucide-react'
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
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { MultiSelect } from '@/components/ui/MultiSelect'

import { useFormModal } from '@/hooks/useFormModal'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { usePagination } from '@/hooks/usePagination'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'

import {
  usePromotionStore,
  selectPromotions,
  selectIsLoading,
  usePromotionActions,
} from '@/stores/promotionStore'
import { useCatalogStore, usePromotionTypes } from '@/stores/catalogStore'
import { useBranchStore, selectSelectedBranchId, selectBranches } from '@/stores/branchStore'

import { getPromotionPreview, deletePromotionWithCascade } from '@/services/cascadeService'
import { validatePromotion } from '@/utils/validation'
import { formatPrice } from '@/utils/formatters'
import { formatPromotionValidity, getPromotionStatus } from '@/utils/formatters'
import { handleError } from '@/utils/logger'
import { toast } from '@/stores/toastStore'
import { helpContent } from '@/utils/helpContent'
import type { Promotion, PromotionFormData } from '@/types/menu'
import type { FormState } from '@/types/form'
import type { TableColumn } from '@/components/ui/Table'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_FORM_DATA: PromotionFormData = {
  name: '',
  description: '',
  price: 0,
  start_date: '',
  start_time: '',
  end_date: '',
  end_time: '',
  promotion_type_id: null,
  branch_ids: [],
  product_ids: [],
  is_active: true,
}

type StatusFilter = 'all' | 'active' | 'inactive'
type ValidityFilter = 'all' | 'scheduled' | 'active' | 'expired'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PromotionsPage() {
  const { t } = useTranslation()

  // Permissions
  const { canManagePromotions, canDeletePromotion } = useAuthPermissions()

  // Store — named selectors, never destructure
  const items = usePromotionStore(selectPromotions)
  const isLoading = usePromotionStore(selectIsLoading)
  const { fetchAsync, createAsync, updateAsync, toggleActiveAsync } = usePromotionActions()

  // CatalogStore — promotion types
  const promotionTypes = usePromotionTypes()
  const fetchPromotionTypesAsync = useCatalogStore((s) => s.fetchPromotionTypesAsync)

  // BranchStore
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const branches = useBranchStore(useShallow(selectBranches))

  // Freeze now at render time for consistent filter (design.md D6)
  const now = useMemo(() => new Date(), [])

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [validityFilter, setValidityFilter] = useState<ValidityFilter>('all')
  const [branchFilter, setBranchFilter] = useState<string | null>(selectedBranchId)

  // Hook trio
  const modal = useFormModal<PromotionFormData, Promotion>({
    ...INITIAL_FORM_DATA,
    branch_ids: selectedBranchId ? [selectedBranchId] : [],
  })
  const deleteDialog = useConfirmDialog<Promotion>()

  // Initial fetch
  useEffect(() => {
    void fetchAsync()
    void fetchPromotionTypesAsync()
  }, [fetchAsync, fetchPromotionTypesAsync])

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((p) => {
      if (statusFilter === 'active' && !p.is_active) return false
      if (statusFilter === 'inactive' && p.is_active) return false
      if (validityFilter !== 'all') {
        const status = getPromotionStatus(p, now)
        if (status !== validityFilter) return false
      }
      if (branchFilter) {
        if (!p.branches.some((b) => b.branch_id === branchFilter)) return false
      }
      return true
    })
  }, [items, statusFilter, validityFilter, branchFilter, now])

  // Sorted items
  const sortedItems = useMemo(
    () => [...filteredItems].sort((a, b) => a.name.localeCompare(b.name)),
    [filteredItems],
  )

  // Pagination
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } =
    usePagination(sortedItems)

  // ---------------------------------------------------------------------------
  // Form submission — useActionState
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (
      _prev: FormState<PromotionFormData>,
      _formData: FormData,
    ): Promise<FormState<PromotionFormData>> => {
      // Use modal.formData directly (controlled fields: DateRangePicker, MultiSelect)
      const data: PromotionFormData = {
        name: modal.formData.name,
        description: modal.formData.description,
        price: modal.formData.price,
        start_date: modal.formData.start_date,
        start_time: modal.formData.start_time,
        end_date: modal.formData.end_date,
        end_time: modal.formData.end_time,
        promotion_type_id: modal.formData.promotion_type_id,
        branch_ids: modal.formData.branch_ids,
        product_ids: modal.formData.product_ids,
        is_active: modal.formData.is_active,
      }

      const validation = validatePromotion(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (modal.selectedItem) {
          await updateAsync(modal.selectedItem.id, data)
          toast.success(t('promotions.messages.updated'))
        } else {
          await createAsync(data)
          toast.success(t('promotions.messages.created'))
        }
        return { isSuccess: true }
      } catch (error) {
        const message = handleError(error, 'PromotionsPage.submitAction')
        toast.error(message)
        return { isSuccess: false, message }
      }
    },
    [modal.formData, modal.selectedItem, createAsync, updateAsync, t],
  )

  const [state, formAction, isPending] = useActionState<FormState<PromotionFormData>, FormData>(
    submitAction,
    { isSuccess: false },
  )

  // Close modal on success
  if (state.isSuccess && modal.isOpen) modal.close()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openEditModal = useCallback(
    (item: Promotion) => {
      modal.openEdit(item, (p) => ({
        name: p.name,
        description: p.description ?? '',
        price: p.price,
        start_date: p.start_date,
        start_time: p.start_time.slice(0, 5),   // HH:mm:ss → HH:mm
        end_date: p.end_date,
        end_time: p.end_time.slice(0, 5),
        promotion_type_id: p.promotion_type_id ?? null,
        branch_ids: p.branches.map((b) => b.branch_id),
        product_ids: p.items.map((i) => i.product_id),
        is_active: p.is_active,
      }))
    },
    [modal],
  )

  const handleToggleActive = useCallback(
    async (item: Promotion) => {
      try {
        await toggleActiveAsync(item.id)
        toast.success(
          item.is_active
            ? t('promotions.messages.deactivateSuccess')
            : t('promotions.messages.activateSuccess'),
        )
      } catch {
        // rollback + toast already handled in store
      }
    },
    [toggleActiveAsync, t],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteDialog.item) return
    try {
      await deletePromotionWithCascade(deleteDialog.item.id)
      toast.success(t('promotions.messages.deleted'))
      deleteDialog.close()
    } catch (error) {
      handleError(error, 'PromotionsPage.handleDelete')
    }
  }, [deleteDialog, t])

  // ---------------------------------------------------------------------------
  // Branch options for MultiSelect
  // ---------------------------------------------------------------------------
  const branchOptions = useMemo(
    () => branches.map((b) => ({ value: String(b.id), label: b.name })),
    [branches],
  )

  // Filter options
  const branchFilterOptions = useMemo(
    () => [
      { value: '', label: t('promotions.filters.allBranches') },
      ...branches.map((b) => ({ value: String(b.id), label: b.name })),
    ],
    [branches, t],
  )

  // Promotion type options for Select
  const promotionTypeOptions = useMemo(
    () => [
      { value: '', label: '—' },
      ...promotionTypes.map((pt) => ({ value: pt.id, label: pt.name })),
    ],
    [promotionTypes],
  )

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<Promotion>[] = useMemo(
    () => [
      {
        key: 'name',
        label: t('promotions.columns.name'),
        render: (item) => (
          <div>
            <span className="font-medium">{item.name}</span>
            {item.description && (
              <p className="text-xs text-[var(--text-muted)] truncate max-w-xs">{item.description}</p>
            )}
          </div>
        ),
      },
      {
        key: 'validity',
        label: t('promotions.columns.validity'),
        width: 'w-44',
        render: (item) => (
          <span className="text-sm font-mono">{formatPromotionValidity(item)}</span>
        ),
      },
      {
        key: 'branches',
        label: t('promotions.columns.branches'),
        width: 'w-24',
        render: (item) => (
          <Badge variant="neutral">
            <span className="sr-only">Sucursales:</span>
            {item.branches.length}
          </Badge>
        ),
      },
      {
        key: 'status',
        label: t('promotions.columns.status'),
        width: 'w-36',
        render: (item) => {
          const validity = getPromotionStatus(item, now)
          return (
            <div className="flex flex-col gap-1">
              <Toggle
                label=""
                checked={item.is_active}
                onChange={() => void handleToggleActive(item)}
                aria-label={t('promotions.toggleActive', { name: item.name })}
              />
              {item.is_active ? (
                validity === 'active' ? (
                  <Badge variant="success">
                    <span className="sr-only">Estado:</span>
                    {t('promotions.status.active')}
                  </Badge>
                ) : validity === 'scheduled' ? (
                  <Badge variant="warning">
                    <span className="sr-only">Estado:</span>
                    {t('promotions.status.scheduled')}
                  </Badge>
                ) : (
                  <Badge variant="neutral">
                    <span className="sr-only">Estado:</span>
                    {t('promotions.status.expired')}
                  </Badge>
                )
              ) : (
                <Badge variant="danger">
                  <span className="sr-only">Estado:</span>
                  {t('promotions.status.inactive')}
                </Badge>
              )}
            </div>
          )
        },
      },
      {
        key: 'actions',
        label: t('promotions.columns.actions'),
        width: 'w-24',
        render: (item) => (
          <div className="flex items-center gap-1">
            {canManagePromotions && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  openEditModal(item)
                }}
                aria-label={`Editar ${item.name}`}
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
            {canDeletePromotion && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteDialog.open(item)
                }}
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
    [t, canManagePromotions, canDeletePromotion, openEditModal, deleteDialog, handleToggleActive, now],
  )

  // ---------------------------------------------------------------------------
  // Permission guard
  // ---------------------------------------------------------------------------
  if (!canManagePromotions) {
    return <Navigate to="/" replace />
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <PageContainer
      title={t('promotions.title')}
      description={t('promotions.description')}
      helpContent={helpContent.promotions}
      actions={
        <Button onClick={() => modal.openCreate()}>
          {t('promotions.create')}
        </Button>
      }
    >
      {/* Filters row */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Select
          label={t('promotions.filters.status')}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          options={[
            { value: 'all', label: t('promotions.filters.all') },
            { value: 'active', label: t('promotions.filters.active') },
            { value: 'inactive', label: t('promotions.filters.inactive') },
          ]}
        />
        <Select
          label={t('promotions.filters.validity')}
          value={validityFilter}
          onChange={(e) => setValidityFilter(e.target.value as ValidityFilter)}
          options={[
            { value: 'all', label: t('promotions.filters.all') },
            { value: 'scheduled', label: t('promotions.filters.scheduled') },
            { value: 'active', label: t('promotions.filters.active') },
            { value: 'expired', label: t('promotions.filters.expired') },
          ]}
        />
        <Select
          label={t('promotions.filters.branch')}
          value={branchFilter ?? ''}
          onChange={(e) => setBranchFilter(e.target.value || null)}
          options={branchFilterOptions}
        />
      </div>

      <Card>
        {isLoading && items.length === 0 ? (
          <TableSkeleton rows={5} columns={5} />
        ) : (
          <Table
            columns={columns}
            items={paginatedItems}
            rowKey={(item) => item.id}
            emptyMessage={t('promotions.empty')}
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
        title={modal.selectedItem ? t('promotions.edit') : t('promotions.create')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="promotion-form" isLoading={isPending}>
              {modal.selectedItem ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="promotion-form" action={formAction} className="space-y-4">
          {/* HelpButton — mandatory first element in every modal form */}
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Promocion"
              size="sm"
              content={
                <div className="space-y-3">
                  <p><strong>Completa los campos</strong> para crear o editar una promocion:</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Nombre:</strong> Identificador de la promocion. Obligatorio, max 120 chars.</li>
                    <li><strong>Precio:</strong> En centavos (ej: 12550 = $125.50). Debe ser 0 o positivo.</li>
                    <li><strong>Tipo:</strong> Clasificacion de la promocion (2x1, combo, etc.). Opcional.</li>
                    <li><strong>Vigencia:</strong> Fecha y hora de inicio y fin. El fin debe ser posterior al inicio.</li>
                    <li><strong>Sucursales:</strong> Selecciona las sucursales donde aplica. Minimo 1.</li>
                    <li><strong>Productos:</strong> Opcional. Agrega productos del catalogo para detallar la promo.</li>
                  </ul>
                  <div className="bg-zinc-800 p-3 rounded-lg mt-3">
                    <p className="text-orange-400 font-medium text-sm">Nota:</p>
                    <p className="text-sm mt-1">El precio se ingresa en centavos. El display en la tabla lo convierte automaticamente.</p>
                  </div>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda sobre el formulario</span>
          </div>

          <Input
            label={t('promotions.fields.name')}
            name="name"
            value={modal.formData.name}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={state.errors?.name ? t(state.errors.name) : undefined}
            required
          />

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
              {t('promotions.fields.description')}
            </label>
            <textarea
              name="description"
              value={modal.formData.description}
              onChange={(e) => modal.setFormData((prev) => ({ ...prev, description: e.target.value }))}
              rows={2}
              className="w-full rounded-md border border-[var(--border-input)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {state.errors?.description && (
              <p className="text-sm text-[var(--danger-text)] mt-1">{t(state.errors.description)}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input
                label={t('promotions.fields.price')}
                name="price"
                type="number"
                min="0"
                step="1"
                value={String(modal.formData.price)}
                onChange={(e) =>
                  modal.setFormData((prev) => ({
                    ...prev,
                    price: parseInt(e.target.value, 10) || 0,
                  }))
                }
                error={state.errors?.price ? t(state.errors.price) : undefined}
                required
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {formatPrice(modal.formData.price)}
              </p>
            </div>

            <Select
              label={t('promotions.fields.promotionType')}
              name="promotion_type_id"
              value={modal.formData.promotion_type_id ?? ''}
              onChange={(e) =>
                modal.setFormData((prev) => ({
                  ...prev,
                  promotion_type_id: e.target.value || null,
                }))
              }
              options={promotionTypeOptions}
            />
          </div>

          <DateRangePicker
            startDate={modal.formData.start_date}
            startTime={modal.formData.start_time}
            endDate={modal.formData.end_date}
            endTime={modal.formData.end_time}
            labelStart={t('promotions.fields.startDate')}
            labelEnd={t('promotions.fields.endDate')}
            onChange={(value) =>
              modal.setFormData((prev) => ({
                ...prev,
                start_date: value.startDate,
                start_time: value.startTime,
                end_date: value.endDate,
                end_time: value.endTime,
              }))
            }
            error={
              state.errors?.end_date
                ? t(state.errors.end_date)
                : state.errors?.start_date
                  ? t(state.errors.start_date)
                  : undefined
            }
          />

          <MultiSelect
            label={t('promotions.fields.branches')}
            options={branchOptions}
            selected={modal.formData.branch_ids}
            onChange={(selected) =>
              modal.setFormData((prev) => ({ ...prev, branch_ids: selected }))
            }
            error={state.errors?.branch_ids ? t(state.errors.branch_ids) : undefined}
          />

          {/* Products inline table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                {t('promotions.fields.products')}
              </span>
              {/* Products linking handled post-create via linkProductAsync */}
            </div>
            {modal.formData.product_ids.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Sin productos vinculados.</p>
            ) : (
              <ul className="space-y-1">
                {modal.formData.product_ids.map((pid) => (
                  <li key={pid} className="flex items-center justify-between rounded border border-[var(--border-input)] px-3 py-1.5 text-sm">
                    <span>{pid}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        modal.setFormData((prev) => ({
                          ...prev,
                          product_ids: prev.product_ids.filter((p) => p !== pid),
                        }))
                      }
                      aria-label={`Quitar producto ${pid}`}
                      type="button"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Toggle
            label={t('promotions.fields.isActive')}
            name="is_active"
            checked={modal.formData.is_active}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
          />
        </form>
      </Modal>

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={deleteDialog.close}
        onConfirm={handleDelete}
        title={t('promotions.delete')}
        message={`¿Estas seguro de eliminar "${deleteDialog.item?.name}"?`}
        confirmLabel={t('common.delete')}
      >
        {deleteDialog.item &&
          (() => {
            const preview = null as Awaited<ReturnType<typeof getPromotionPreview>> | null
            // Note: preview is async; for sync UX we show the branch/item counts directly
            const item = deleteDialog.item
            const syncPreview =
              item.branches.length > 0 || item.items.length > 0
                ? {
                    totalItems: item.branches.length + item.items.length,
                    items: [
                      ...(item.branches.length > 0
                        ? [{ label: 'promotions.cascade.branches', count: item.branches.length }]
                        : []),
                      ...(item.items.length > 0
                        ? [{ label: 'promotions.cascade.items', count: item.items.length }]
                        : []),
                    ],
                  }
                : null
            void preview
            return syncPreview ? <CascadePreviewList preview={syncPreview} /> : null
          })()}
      </ConfirmDialog>
    </PageContainer>
  )
}

// Export named for testing
export { PromotionsPage }
