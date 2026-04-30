---
name: react19-form-pattern
description: >
  Standardizes form handling using React 19's useActionState hook across all frontends.
  Trigger: When creating or refactoring form components in Dashboard, pwaMenu, or pwaWaiter.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Creating any new form component (create/edit modal, standalone form)
- Refactoring an existing form that uses `useState` + manual handlers
- Any CRUD page that submits user input to a store or API

## Critical Patterns

### NEVER use the old pattern

```typescript
// WRONG — do not do this
const [formData, setFormData] = useState({ name: '' })
const [errors, setErrors] = useState({})
const [isLoading, setIsLoading] = useState(false)

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  setIsLoading(true)
  // ...
}
```

### ALWAYS use useActionState

```typescript
import { useActionState, useCallback } from 'react'
import type { FormState } from '../types/form'

const submitAction = useCallback(
  async (_prevState: FormState<MyFormData>, formData: FormData): Promise<FormState<MyFormData>> => {
    // 1. Extract typed fields from FormData
    const data: MyFormData = {
      name: formData.get('name') as string,
      count: parseInt(formData.get('count') as string, 10) || 0,
      is_active: formData.get('is_active') === 'on',
    }

    // 2. Validate via centralized validator — never inline
    const validation = validateMyEntity(data)
    if (!validation.isValid) {
      return { errors: validation.errors, isSuccess: false }
    }

    // 3. Call store action or API
    try {
      if (modal.selectedItem) {
        await updateItem(modal.selectedItem.id, data)
        toast.success('Actualizado correctamente')
      } else {
        await createItem(data)
        toast.success('Creado correctamente')
      }
      return { isSuccess: true, message: 'Guardado correctamente' }
    } catch (error) {
      const message = handleError(error, 'MyComponent.submitAction')
      toast.error(`Error al guardar: ${message}`)
      return { isSuccess: false, message: `Error: ${message}` }
    }
  },
  [modal.selectedItem, updateItem, createItem]
)

const [state, formAction, isPending] = useActionState<FormState<MyFormData>, FormData>(
  submitAction,
  { isSuccess: false }
)
```

### FormState type (from `src/types/form.ts`)

```typescript
// Already defined in Dashboard/src/types/form.ts — import it, don't redefine
import type { FormState } from '../types/form'

// The definition for reference:
export type FormState<T = Record<string, unknown>> = {
  errors?: ValidationErrors<T>   // field-level errors (from validation.ts)
  message?: string               // global message
  isSuccess?: boolean            // controls modal close / reset
}
```

### Modal close on success

```typescript
// After useActionState — NOT inside the action function
if (state.isSuccess && modal.isOpen) {
  modal.close()
}
```

### JSX — form wiring

```tsx
// form uses action={formAction}, NOT onSubmit
<form id="my-entity-form" action={formAction}>
  <input name="name" defaultValue={modal.formData.name} />
  {state.errors?.name && (
    <span className="text-red-400 text-sm">{state.errors.name}</span>
  )}
</form>

// Submit button uses isPending — can live outside the form via form=""
<Button type="submit" form="my-entity-form" isLoading={isPending}>
  {modal.selectedItem ? 'Guardar' : 'Crear'}
</Button>
```

### isPending — loading state

```tsx
// ALWAYS disable submit while pending to prevent double-submit
<button type="submit" disabled={isPending}>
  {isPending ? 'Guardando...' : 'Guardar'}
</button>

// Or via the shared Button component (preferred in Dashboard)
<Button type="submit" form="my-entity-form" isLoading={isPending}>
  {modal.selectedItem ? 'Guardar' : 'Crear'}
</Button>
```

## FormData Extraction Reference

| Field type | Extraction pattern |
|------------|-------------------|
| string | `formData.get('field') as string` |
| number (int) | `parseInt(formData.get('field') as string, 10) \|\| 0` |
| number (float) | `parseFloat(formData.get('field') as string) \|\| 0` |
| boolean (checkbox) | `formData.get('field') === 'on'` |
| hidden field | `formData.get('field') as string` |

Always use `parseInt(value, 10)` — never omit the radix.

## Validation Rules

- Validation lives in `src/utils/validation.ts` — one function per entity (e.g., `validateCategory`, `validateProduct`)
- Never write validation logic inside the action function
- `ValidationErrors<T>` is `Partial<Record<keyof T, string>>` — one message per field
- Number helpers: `isValidNumber`, `isPositiveNumber`, `isNonNegativeNumber` (imported from `validation.ts`)

```typescript
// Correct pattern inside submitAction
const validation = validateCategory(data)
if (!validation.isValid) {
  return { errors: validation.errors, isSuccess: false }
}
```

## useCallback Dependency Rules

Wrap `submitAction` in `useCallback`. Dependencies must include every store action and piece of state the action reads:

```typescript
const submitAction = useCallback(
  async (_prevState, formData) => { /* ... */ },
  [modal.selectedItem, updateItem, createItem]   // list all deps
)
```

React Compiler enforces this — missing deps cause stale closure bugs.

## Complete Minimal Example

```tsx
import { useActionState, useCallback } from 'react'
import type { FormState } from '../types/form'
import { validateCategory } from '../utils/validation'
import { handleError } from '../utils/logger'
import { toast } from '../stores/toastStore'
import { useFormModal } from '../hooks'

interface CategoryFormData {
  name: string
  is_active: boolean
}

export function CategoryForm() {
  const modal = useFormModal<CategoryFormData>({ name: '', is_active: true })
  const updateCategory = useCategoryStore((s) => s.updateCategory)
  const createCategory = useCategoryStore((s) => s.createCategory)

  const submitAction = useCallback(
    async (_prev: FormState<CategoryFormData>, formData: FormData): Promise<FormState<CategoryFormData>> => {
      const data: CategoryFormData = {
        name: formData.get('name') as string,
        is_active: formData.get('is_active') === 'on',
      }

      const validation = validateCategory(data)
      if (!validation.isValid) {
        return { errors: validation.errors, isSuccess: false }
      }

      try {
        if (modal.selectedItem) {
          updateCategory(modal.selectedItem.id, data)
          toast.success('Categoria actualizada correctamente')
        } else {
          createCategory(data)
          toast.success('Categoria creada correctamente')
        }
        return { isSuccess: true }
      } catch (error) {
        const message = handleError(error, 'CategoryForm.submitAction')
        toast.error(`Error al guardar la categoria: ${message}`)
        return { isSuccess: false, message }
      }
    },
    [modal.selectedItem, updateCategory, createCategory]
  )

  const [state, formAction, isPending] = useActionState<FormState<CategoryFormData>, FormData>(
    submitAction,
    { isSuccess: false }
  )

  if (state.isSuccess && modal.isOpen) {
    modal.close()
  }

  return (
    <form id="category-form" action={formAction}>
      <input name="name" defaultValue={modal.formData.name} />
      {state.errors?.name && <span className="text-red-400 text-sm">{state.errors.name}</span>}
      <input type="checkbox" name="is_active" defaultChecked={modal.formData.is_active} />
      <Button type="submit" form="category-form" isLoading={isPending}>
        {modal.selectedItem ? 'Guardar' : 'Crear'}
      </Button>
    </form>
  )
}
```

## Common Mistakes

| Mistake | Correct approach |
|---------|-----------------|
| `onSubmit` + `e.preventDefault()` | Use `action={formAction}` on `<form>` |
| Inline validation logic | Call `validateX(data)` from `utils/validation.ts` |
| `useState` for loading | Use `isPending` from `useActionState` |
| Closing modal inside action | Close via `if (state.isSuccess && modal.isOpen) modal.close()` outside the action |
| `console.log` in catch | Use `handleError(error, 'ComponentName.fnName')` from `utils/logger` |
| `parseInt` without radix | Always `parseInt(value, 10)` |

## Resources

> ⚠️ **Nota**: `FormState<T>` en `Dashboard/src/types/form.ts` y los hooks de validación se crean en C-14.

- **Reference implementation**: `Dashboard/src/pages/Categories.tsx` lines 113–175
- **FormState type**: `Dashboard/src/types/form.ts`
- **Validation utilities**: `Dashboard/src/utils/validation.ts`
- **Logger utilities**: `Dashboard/src/utils/logger.ts`
- **useFormModal hook**: `Dashboard/src/hooks/useFormModal.ts`
