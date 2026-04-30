/**
 * Input — accessible text input with label and error display.
 *
 * Skill: dashboard-crud-page, interface-design
 */

import { forwardRef, useId, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ label, error, hint, id, className = '', ...props }, ref) {
    const generatedId = useId()
    const inputId = id ?? `input-${generatedId}`
    const errorId = error ? `${inputId}-error` : undefined
    const hintId = hint ? `${inputId}-hint` : undefined

    const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-gray-300"
          >
            {label}
            {props.required && <span className="ml-1 text-red-400" aria-hidden="true">*</span>}
          </label>
        )}
        <input
          {...props}
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={[
            'w-full rounded-md border px-3 py-2 text-sm text-white bg-gray-800',
            'placeholder:text-gray-500 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-primary/70 focus:border-transparent',
            error
              ? 'border-red-500 focus:ring-red-500/70'
              : 'border-gray-600 hover:border-gray-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            className,
          ].join(' ')}
        />
        {hint && !error && (
          <p id={hintId} className="text-xs text-gray-400">{hint}</p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-400">{error}</p>
        )}
      </div>
    )
  },
)
