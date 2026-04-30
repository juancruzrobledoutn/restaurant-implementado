/**
 * Shared form types for Dashboard.
 *
 * FormState<T> is the return type of all useActionState actions.
 * Import this type in every CRUD page — never redefine it locally.
 *
 * Skill: react19-form-pattern
 */

/** Field-level validation errors: one error message per field. */
export type ValidationErrors<T = Record<string, unknown>> = Partial<Record<keyof T, string>>

/**
 * State returned by every useActionState action in the Dashboard.
 *
 * Usage:
 *   const [state, formAction, isPending] = useActionState<FormState<MyData>, FormData>(
 *     submitAction,
 *     { isSuccess: false }
 *   )
 */
export type FormState<T = Record<string, unknown>> = {
  /** Field-level validation errors from validateX() helpers */
  errors?: ValidationErrors<T>
  /** Global message — shown below the form or in a toast */
  message?: string
  /** True after a successful submission — use to close modal at render time */
  isSuccess?: boolean
}
