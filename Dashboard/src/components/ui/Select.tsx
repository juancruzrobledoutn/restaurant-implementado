/**
 * Select — accessible custom select wrapper.
 *
 * Skill: dashboard-crud-page, interface-design
 */

import { useId, type SelectHTMLAttributes } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  hint?: string
  options: SelectOption[]
  placeholder?: string
}

export function Select({
  label,
  error,
  hint,
  options,
  placeholder,
  id,
  className = '',
  ...props
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? `select-${generatedId}`
  const errorId = error ? `${selectId}-error` : undefined

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-gray-300">
          {label}
          {props.required && <span className="ml-1 text-red-400" aria-hidden="true">*</span>}
        </label>
      )}
      <select
        {...props}
        id={selectId}
        aria-invalid={!!error}
        aria-describedby={errorId}
        className={[
          'w-full rounded-md border px-3 py-2 text-sm text-white bg-gray-800',
          'transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-primary/70 focus:border-transparent',
          error
            ? 'border-red-500 focus:ring-red-500/70'
            : 'border-gray-600 hover:border-gray-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        ].join(' ')}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint && !error && (
        <p className="text-xs text-gray-400">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}
