/**
 * Recipes — tenant-scoped recipe CRUD page.
 *
 * Skills: dashboard-crud-page, react19-form-pattern, help-system-content
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useActionState } from 'react'
import { Pencil, Trash2, Plus, Minus } from 'lucide-react'
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

import { useRecipeStore, selectRecipes, selectRecipeIsLoading, useRecipeActions } from '@/stores/recipeStore'
import { useProductStore, selectProducts } from '@/stores/productStore'
import { useIngredientStore } from '@/stores/ingredientStore'
import { validateRecipe } from '@/utils/validation'
import { handleError } from '@/utils/logger'
import { helpContent } from '@/utils/helpContent'
import type { Recipe, RecipeFormData, RecipeIngredient } from '@/types/menu'
import type { FormState } from '@/types/form'
import type { TableColumn } from '@/components/ui/Table'

const INITIAL_FORM_DATA: RecipeFormData = {
  name: '',
  product_id: '',
  ingredients: [],
  is_active: true,
}

export default function RecipesPage() {
  const { t } = useTranslation()

  // Stores
  const items = useRecipeStore(selectRecipes)
  const isLoading = useRecipeStore(selectRecipeIsLoading)
  const { fetchAsync, createAsync, updateAsync, deleteAsync } = useRecipeActions()

  const allProducts = useProductStore(selectProducts)
  const allIngredients = useIngredientStore((s) => s.ingredients)
  const ingredientOptions = useMemo(
    () => allIngredients.map((i) => ({ value: i.id, label: `${i.name}${i.unit ? ` (${i.unit})` : ''}` })),
    [allIngredients],
  )
  const productOptions = useMemo(
    () => allProducts.map((p) => ({ value: p.id, label: p.name })),
    [allProducts],
  )

  const { canCreate, canEdit, canDelete } = useAuthPermissions()

  // Hook trio
  const modal = useFormModal<RecipeFormData, Recipe>(INITIAL_FORM_DATA)
  const deleteDialog = useConfirmDialog<Recipe>()

  // Sort
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  )

  // Pagination
  const { paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage } = usePagination(sortedItems)

  useEffect(() => { void fetchAsync() }, [fetchAsync])

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  const submitAction = useCallback(
    async (_prev: FormState<RecipeFormData>, formData: FormData): Promise<FormState<RecipeFormData>> => {
      const data: RecipeFormData = {
        name: formData.get('name') as string,
        product_id: formData.get('product_id') as string,
        is_active: formData.get('is_active') === 'on',
        ingredients: modal.formData.ingredients, // managed in state, not individual form fields
      }

      const validation = validateRecipe(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (modal.selectedItem) {
          await updateAsync(modal.selectedItem.id, data)
        } else {
          await createAsync(data)
        }
        return { isSuccess: true }
      } catch (error) {
        return { isSuccess: false, message: handleError(error, 'RecipesPage.submitAction') }
      }
    },
    [modal.selectedItem, modal.formData.ingredients, createAsync, updateAsync],
  )

  const [state, formAction, isPending] = useActionState<FormState<RecipeFormData>, FormData>(
    submitAction,
    { isSuccess: false },
  )

  if (state.isSuccess && modal.isOpen) modal.close()

  // ---------------------------------------------------------------------------
  // Ingredient line management
  // ---------------------------------------------------------------------------
  function addIngredientLine() {
    modal.setFormData((prev) => ({
      ...prev,
      ingredients: [...prev.ingredients, { ingredient_id: '', quantity: 1, unit: '' }],
    }))
  }

  function removeIngredientLine(index: number) {
    modal.setFormData((prev) => ({
      ...prev,
      ingredients: prev.ingredients.filter((_, i) => i !== index),
    }))
  }

  function updateIngredientLine(index: number, patch: Partial<RecipeIngredient>) {
    modal.setFormData((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ing, i) => i === index ? { ...ing, ...patch } : ing),
    }))
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const openEditModal = useCallback(
    (item: Recipe) => {
      modal.openEdit(item, (r) => ({
        name: r.name,
        product_id: r.product_id,
        is_active: r.is_active,
        ingredients: r.ingredients.map((ing) => ({ ...ing })),
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
      handleError(error, 'RecipesPage.handleDelete')
    }
  }, [deleteDialog, deleteAsync])

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  const columns: TableColumn<Recipe>[] = useMemo(
    () => [
      {
        key: 'name',
        label: t('recipes.name'),
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
        key: 'product_id',
        label: t('recipes.product'),
        width: 'w-40',
        render: (item) => {
          const product = allProducts.find((p) => p.id === item.product_id)
          return <span className="text-sm">{product?.name ?? item.product_id}</span>
        },
      },
      {
        key: 'ingredients',
        label: t('recipes.ingredients'),
        width: 'w-24',
        render: (item) => <span className="text-sm">{item.ingredients.length} items</span>,
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
    [t, canEdit, canDelete, openEditModal, deleteDialog, allProducts],
  )

  return (
    <PageContainer
      title={t('recipes.title')}
      description="Gestiona las recetas de los productos del tenant."
      helpContent={helpContent.recipes}
      actions={
        canCreate ? (
          <Button onClick={() => modal.openCreate()}>
            {t('recipes.new')}
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
            emptyMessage={t('recipes.empty')}
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
        title={modal.selectedItem ? t('recipes.edit') : t('recipes.new')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={modal.close}>{t('common.cancel')}</Button>
            <Button type="submit" form="recipe-form" isLoading={isPending}>
              {modal.selectedItem ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="recipe-form" action={formAction} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Receta"
              size="sm"
              content={
                <div className="space-y-3">
                  <p><strong>Completa los campos</strong> para crear o editar una receta:</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Nombre:</strong> Nombre descriptivo de la receta. Obligatorio.</li>
                    <li><strong>Producto:</strong> Producto al que pertenece esta receta. Obligatorio.</li>
                    <li><strong>Ingredientes:</strong> Agrega ingredientes con cantidad y unidad.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda</span>
          </div>

          <Input
            label={t('recipes.name')}
            name="name"
            placeholder={t('recipes.namePlaceholder')}
            value={modal.formData.name}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={state.errors?.name}
            required
          />

          <Select
            label={t('recipes.product')}
            name="product_id"
            options={productOptions}
            value={modal.formData.product_id}
            onChange={(e) => modal.setFormData((prev) => ({ ...prev, product_id: e.target.value }))}
            placeholder="Selecciona un producto"
          />

          {/* Ingredient lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{t('recipes.ingredients')}</span>
              <Button variant="ghost" size="sm" type="button" onClick={addIngredientLine}>
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
                {t('recipes.addIngredient')}
              </Button>
            </div>

            {modal.formData.ingredients.length === 0 && (
              <p className="text-sm text-[var(--text-muted)] py-2">
                No hay ingredientes. Hace clic en "Agregar ingrediente".
              </p>
            )}

            <div className="space-y-2">
              {modal.formData.ingredients.map((ing, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Select
                      label=""
                      name={`ingredient_id_${index}`}
                      options={ingredientOptions}
                      value={ing.ingredient_id}
                      onChange={(e) => updateIngredientLine(index, { ingredient_id: e.target.value })}
                      placeholder="Ingrediente"
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      label=""
                      name={`quantity_${index}`}
                      type="number"
                      placeholder="Cant."
                      value={String(ing.quantity)}
                      onChange={(e) => updateIngredientLine(index, { quantity: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="w-20">
                    <Input
                      label=""
                      name={`unit_${index}`}
                      placeholder="Unidad"
                      value={ing.unit}
                      onChange={(e) => updateIngredientLine(index, { unit: e.target.value })}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => removeIngredientLine(index)}
                    className="text-[var(--danger-icon)] hover:text-[var(--danger-text)] shrink-0"
                    aria-label={`Quitar ingrediente ${index + 1}`}
                  >
                    <Minus className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

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
        title={t('recipes.delete')}
        message={`¿Estas seguro de eliminar "${deleteDialog.item?.name}"?`}
        confirmLabel={t('common.delete')}
      />
    </PageContainer>
  )
}
