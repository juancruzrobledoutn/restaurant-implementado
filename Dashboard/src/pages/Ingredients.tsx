/**
 * Ingredients — tenant-scoped ingredient group/ingredient CRUD page.
 *
 * Shows groups with expandable ingredient lists. One modal for groups,
 * one for ingredients. Sub-ingredients are managed inline in a future iteration.
 *
 * Skills: dashboard-crud-page, react19-form-pattern, help-system-content
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useActionState } from 'react'
import { Pencil, Trash2, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { PageContainer } from '@/components/ui/PageContainer'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { TableSkeleton } from '@/components/ui/TableSkeleton'
import { HelpButton } from '@/components/ui/HelpButton'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { CascadePreviewList } from '@/components/ui/CascadePreviewList'

import { useFormModal } from '@/hooks/useFormModal'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { useAuthPermissions } from '@/hooks/useAuthPermissions'

import { useIngredientStore } from '@/stores/ingredientStore'
import { deleteIngredientGroupWithCascade, getIngredientGroupPreview } from '@/services/cascadeService'
import { validateIngredientGroup, validateIngredient } from '@/utils/validation'
import { handleError } from '@/utils/logger'
import { helpContent } from '@/utils/helpContent'
import type {
  IngredientGroup,
  IngredientGroupFormData,
  Ingredient,
  IngredientFormData,
  CascadePreview,
} from '@/types/menu'
import type { FormState } from '@/types/form'

const INITIAL_GROUP_DATA: IngredientGroupFormData = { name: '', is_active: true }
const INITIAL_INGREDIENT_DATA: IngredientFormData = { name: '', unit: '', is_active: true, group_id: '' }

export default function IngredientsPage() {
  const { t } = useTranslation()

  // Store
  const groups = useIngredientStore((s) => s.groups)
  const ingredients = useIngredientStore((s) => s.ingredients)
  const isLoading = useIngredientStore((s) => s.isLoading)
  const storeActions = useIngredientStore(
    useShallow((s) => ({
      fetchGroupsAsync: s.fetchGroupsAsync,
      createGroupAsync: s.createGroupAsync,
      updateGroupAsync: s.updateGroupAsync,
      deleteGroupAsync: s.deleteGroupAsync,
      createIngredientAsync: s.createIngredientAsync,
      updateIngredientAsync: s.updateIngredientAsync,
      deleteIngredientAsync: s.deleteIngredientAsync,
    })),
  )

  const { canCreate, canEdit, canDelete } = useAuthPermissions()

  // Group modal
  const groupModal = useFormModal<IngredientGroupFormData, IngredientGroup>(INITIAL_GROUP_DATA)
  const groupDeleteDialog = useConfirmDialog<IngredientGroup>()

  // Ingredient modal
  const ingredientModal = useFormModal<IngredientFormData, Ingredient>(INITIAL_INGREDIENT_DATA)
  const ingredientDeleteDialog = useConfirmDialog<Ingredient>()

  // Expanded groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Cascade preview
  const [cascadePreview, setCascadePreview] = useState<CascadePreview | null>(null)

  // Sort groups
  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.name.localeCompare(b.name)),
    [groups],
  )

  const { fetchGroupsAsync } = storeActions
  useEffect(() => {
    void fetchGroupsAsync()
  }, [fetchGroupsAsync])

  // ---------------------------------------------------------------------------
  // Group form
  // ---------------------------------------------------------------------------
  const groupSubmitAction = useCallback(
    async (_prev: FormState<IngredientGroupFormData>, formData: FormData): Promise<FormState<IngredientGroupFormData>> => {
      const data: IngredientGroupFormData = {
        name: formData.get('name') as string,
        is_active: formData.get('is_active') === 'on',
      }

      const validation = validateIngredientGroup(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (groupModal.selectedItem) {
          await storeActions.updateGroupAsync(groupModal.selectedItem.id, data)
        } else {
          await storeActions.createGroupAsync(data)
        }
        return { isSuccess: true }
      } catch (error) {
        return { isSuccess: false, message: handleError(error, 'IngredientsPage.groupSubmit') }
      }
    },
    [groupModal.selectedItem, storeActions],
  )

  const [groupState, groupFormAction, groupIsPending] = useActionState<FormState<IngredientGroupFormData>, FormData>(
    groupSubmitAction,
    { isSuccess: false },
  )

  if (groupState.isSuccess && groupModal.isOpen) groupModal.close()

  // ---------------------------------------------------------------------------
  // Ingredient form
  // ---------------------------------------------------------------------------
  const ingredientSubmitAction = useCallback(
    async (_prev: FormState<IngredientFormData>, formData: FormData): Promise<FormState<IngredientFormData>> => {
      const data: IngredientFormData = {
        name: formData.get('name') as string,
        unit: formData.get('unit') as string ?? '',
        is_active: formData.get('is_active') === 'on',
        group_id: formData.get('group_id') as string,
      }

      const validation = validateIngredient(data)
      if (!validation.isValid) return { errors: validation.errors, isSuccess: false }

      try {
        if (ingredientModal.selectedItem) {
          await storeActions.updateIngredientAsync(ingredientModal.selectedItem.id, data)
        } else {
          await storeActions.createIngredientAsync(data)
        }
        return { isSuccess: true }
      } catch (error) {
        return { isSuccess: false, message: handleError(error, 'IngredientsPage.ingredientSubmit') }
      }
    },
    [ingredientModal.selectedItem, storeActions],
  )

  const [ingredientState, ingredientFormAction, ingredientIsPending] = useActionState<FormState<IngredientFormData>, FormData>(
    ingredientSubmitAction,
    { isSuccess: false },
  )

  if (ingredientState.isSuccess && ingredientModal.isOpen) ingredientModal.close()

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleGroupDelete = useCallback(async () => {
    if (!groupDeleteDialog.item) return
    try {
      await deleteIngredientGroupWithCascade(groupDeleteDialog.item.id)
      groupDeleteDialog.close()
      setCascadePreview(null)
    } catch (error) {
      handleError(error, 'IngredientsPage.handleGroupDelete')
    }
  }, [groupDeleteDialog])

  const handleIngredientDelete = useCallback(async () => {
    if (!ingredientDeleteDialog.item) return
    try {
      await storeActions.deleteIngredientAsync(ingredientDeleteDialog.item.id)
      ingredientDeleteDialog.close()
    } catch (error) {
      handleError(error, 'IngredientsPage.handleIngredientDelete')
    }
  }, [ingredientDeleteDialog, storeActions])

  useEffect(() => {
    if (groupDeleteDialog.isOpen && groupDeleteDialog.item) {
      getIngredientGroupPreview(groupDeleteDialog.item.id)
        .then(setCascadePreview)
        .catch(() => setCascadePreview(null))
    } else {
      void Promise.resolve().then(() => setCascadePreview(null))
    }
  }, [groupDeleteDialog.isOpen, groupDeleteDialog.item])

  function toggleGroup(groupId: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <PageContainer
      title={t('ingredients.title')}
      description="Gestiona los grupos e ingredientes del tenant."
      helpContent={helpContent.ingredients}
      actions={
        canCreate ? (
          <Button onClick={() => groupModal.openCreate()}>
            {t('ingredients.newGroup')}
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <Card><TableSkeleton rows={4} columns={3} /></Card>
      ) : sortedGroups.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-[var(--text-muted)]">{t('ingredients.emptyGroup')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedGroups.map((group) => {
            const groupIngredients = ingredients.filter((i) => i.group_id === group.id)
              .sort((a, b) => a.name.localeCompare(b.name))
            const isExpanded = expandedGroups.has(group.id)

            return (
              <Card key={group.id} className="overflow-hidden">
                {/* Group header */}
                <div className="flex items-center gap-3 p-4">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex items-center gap-2 flex-1 text-left"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Colapsar' : 'Expandir'} grupo ${group.name}`}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                    )}
                    <span className="font-semibold">{group.name}</span>
                    <span className="text-xs text-[var(--text-tertiary)]">
                      {groupIngredients.length} ingrediente{groupIngredients.length !== 1 ? 's' : ''}
                    </span>
                    {group._optimistic && (
                      <span className="text-xs text-[var(--text-tertiary)] italic">guardando...</span>
                    )}
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    {group.is_active ? (
                      <Badge variant="success"><span className="sr-only">Estado:</span> Activo</Badge>
                    ) : (
                      <Badge variant="danger"><span className="sr-only">Estado:</span> Inactivo</Badge>
                    )}
                    {canCreate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => ingredientModal.openCreate({ group_id: group.id })}
                        aria-label={`Agregar ingrediente a ${group.name}`}
                      >
                        <Plus className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => groupModal.openEdit(group, (g) => ({ name: g.name, is_active: g.is_active }))}
                        aria-label={`Editar grupo ${group.name}`}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => groupDeleteDialog.open(group)}
                        className="text-[var(--danger-icon)] hover:text-[var(--danger-text)] hover:bg-[var(--danger-border)]/10"
                        aria-label={`Eliminar grupo ${group.name}`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Ingredient list */}
                {isExpanded && (
                  <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-raised)]/30">
                    {groupIngredients.length === 0 ? (
                      <p className="text-sm text-[var(--text-muted)] px-6 py-3">
                        No hay ingredientes en este grupo.
                      </p>
                    ) : (
                      <ul className="divide-y divide-[var(--border-subtle)]">
                        {groupIngredients.map((ing) => (
                          <li key={ing.id} className="flex items-center gap-3 px-6 py-2">
                            <span className="flex-1 text-sm">{ing.name}</span>
                            {ing.unit && (
                              <span className="text-xs text-[var(--text-tertiary)]">{ing.unit}</span>
                            )}
                            {ing.is_active ? (
                              <Badge variant="success"><span className="sr-only">Estado:</span> Activo</Badge>
                            ) : (
                              <Badge variant="danger"><span className="sr-only">Estado:</span> Inactivo</Badge>
                            )}
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => ingredientModal.openEdit(ing, (i) => ({
                                  name: i.name, unit: i.unit ?? '', is_active: i.is_active, group_id: i.group_id,
                                }))}
                                aria-label={`Editar ingrediente ${ing.name}`}
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => ingredientDeleteDialog.open(ing)}
                                className="text-[var(--danger-icon)] hover:text-[var(--danger-text)]"
                                aria-label={`Eliminar ingrediente ${ing.name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Group Modal */}
      <Modal
        isOpen={groupModal.isOpen}
        onClose={groupModal.close}
        title={groupModal.selectedItem ? t('ingredients.editGroup') : t('ingredients.newGroup')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={groupModal.close}>{t('common.cancel')}</Button>
            <Button type="submit" form="group-form" isLoading={groupIsPending}>
              {groupModal.selectedItem ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="group-form" action={groupFormAction} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Grupo"
              size="sm"
              content={
                <div className="space-y-2">
                  <p>Los grupos organizan ingredientes por categoria (ej: Lacteos, Carnes).</p>
                  <ul className="list-disc pl-5 space-y-1 text-sm">
                    <li><strong>Nombre:</strong> Nombre del grupo. Obligatorio.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda</span>
          </div>

          <Input
            label={t('ingredients.groupName')}
            name="name"
            placeholder="Ej: Lacteos"
            value={groupModal.formData.name}
            onChange={(e) => groupModal.setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={groupState.errors?.name}
            required
          />

          <Toggle
            label={t('common.active')}
            name="is_active"
            checked={groupModal.formData.is_active}
            onChange={(e) => groupModal.setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
          />
        </form>
      </Modal>

      {/* Group Delete Dialog */}
      <ConfirmDialog
        isOpen={groupDeleteDialog.isOpen}
        onClose={groupDeleteDialog.close}
        onConfirm={handleGroupDelete}
        title={t('ingredients.deleteGroup')}
        message={`¿Estas seguro de eliminar el grupo "${groupDeleteDialog.item?.name}"?`}
        confirmLabel={t('common.delete')}
      >
        {cascadePreview && cascadePreview.totalItems > 0 && (
          <CascadePreviewList preview={cascadePreview} />
        )}
      </ConfirmDialog>

      {/* Ingredient Modal */}
      <Modal
        isOpen={ingredientModal.isOpen}
        onClose={ingredientModal.close}
        title={ingredientModal.selectedItem ? t('ingredients.editIngredient') : t('ingredients.newIngredient')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={ingredientModal.close}>{t('common.cancel')}</Button>
            <Button type="submit" form="ingredient-form" isLoading={ingredientIsPending}>
              {ingredientModal.selectedItem ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="ingredient-form" action={ingredientFormAction} className="space-y-4">
          <input type="hidden" name="group_id" value={ingredientModal.formData.group_id} />

          <div className="flex items-center gap-2 mb-2">
            <HelpButton
              title="Formulario de Ingrediente"
              size="sm"
              content={
                <div className="space-y-2">
                  <ul className="list-disc pl-5 space-y-1 text-sm">
                    <li><strong>Nombre:</strong> Nombre del ingrediente. Obligatorio.</li>
                    <li><strong>Unidad:</strong> Unidad de medida (g, ml, unidades, etc.). Opcional.</li>
                  </ul>
                </div>
              }
            />
            <span className="text-sm text-[var(--text-tertiary)]">Ayuda</span>
          </div>

          <Input
            label={t('ingredients.ingredientName')}
            name="name"
            placeholder="Ej: Leche"
            value={ingredientModal.formData.name}
            onChange={(e) => ingredientModal.setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={ingredientState.errors?.name}
            required
          />

          <Input
            label={t('ingredients.unit')}
            name="unit"
            placeholder="Ej: ml, g, unidades"
            value={ingredientModal.formData.unit}
            onChange={(e) => ingredientModal.setFormData((prev) => ({ ...prev, unit: e.target.value }))}
          />

          <Toggle
            label={t('common.active')}
            name="is_active"
            checked={ingredientModal.formData.is_active}
            onChange={(e) => ingredientModal.setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
          />
        </form>
      </Modal>

      {/* Ingredient Delete Dialog */}
      <ConfirmDialog
        isOpen={ingredientDeleteDialog.isOpen}
        onClose={ingredientDeleteDialog.close}
        onConfirm={handleIngredientDelete}
        title={t('ingredients.deleteIngredient')}
        message={`¿Estas seguro de eliminar "${ingredientDeleteDialog.item?.name}"?`}
        confirmLabel={t('common.delete')}
      />
    </PageContainer>
  )
}
