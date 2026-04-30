/**
 * Toggle — accessible checkbox toggle with label.
 *
 * Skill: dashboard-crud-page
 */

import { useId, type InputHTMLAttributes } from 'react'

interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
  error?: string
}

export function Toggle({ label, error, id, className = '', ...props }: ToggleProps) {
  const generatedId = useId()
  const inputId = id ?? `toggle-${generatedId}`

  return (
    <div className="flex items-center gap-3">
      <input
        {...props}
        id={inputId}
        type="checkbox"
        aria-invalid={!!error}
        className={[
          'h-4 w-4 rounded border-gray-600 bg-gray-800 text-primary',
          'focus:ring-2 focus:ring-primary/70 focus:ring-offset-gray-900',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'cursor-pointer',
          className,
        ].join(' ')}
      />
      {label && (
        <label
          htmlFor={inputId}
          className="cursor-pointer text-sm text-gray-300"
        >
          {label}
        </label>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}
