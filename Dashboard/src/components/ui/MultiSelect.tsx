/**
 * MultiSelect — accessible multi-select dropdown without external dependencies.
 *
 * Design decisions (design.md D4):
 * - Zero external dependencies: native button + ul[role=listbox] + ARIA.
 * - Keyboard: Enter/Space toggle focused option, ArrowUp/Down navigate,
 *   Home/End first/last, Escape closes + returns focus to trigger.
 * - Click outside closes the dropdown (via document listener).
 * - Hidden input for FormData integration when `name` prop is provided.
 *
 * Reusable for: promotions branches, staff roles, waiter sector assignments.
 *
 * Skill: dashboard-crud-page, interface-design
 */

import { useRef, useState, useEffect, useId, useCallback, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'

export interface MultiSelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface MultiSelectProps {
  label: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  error?: string
  disabled?: boolean
  name?: string
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = 'Selecciona opciones',
  error,
  disabled = false,
  name,
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)

  const listboxId = useId()
  const errorId = useId()
  const labelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasError = Boolean(error)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  function toggleOption(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  function handleTriggerClick() {
    if (disabled) return
    setIsOpen((prev) => !prev)
    setFocusedIndex(0)
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement | HTMLUListElement>) => {
      if (!isOpen) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setIsOpen(true)
          setFocusedIndex(0)
        }
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex((i) => Math.min(i + 1, options.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Home':
          e.preventDefault()
          setFocusedIndex(0)
          break
        case 'End':
          e.preventDefault()
          setFocusedIndex(options.length - 1)
          break
        case 'Enter':
        case ' ': {
          e.preventDefault()
          const option = options[focusedIndex]
          if (option && !option.disabled) {
            toggleOption(option.value)
          }
          break
        }
        case 'Escape':
          e.preventDefault()
          setIsOpen(false)
          triggerRef.current?.focus()
          break
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, focusedIndex, options, selected],
  )

  const summaryLabel =
    selected.length === 0
      ? placeholder
      : `${selected.length} seleccionada${selected.length === 1 ? '' : 's'}`

  return (
    <div ref={containerRef} className="relative space-y-1">
      {/* Label */}
      <span
        id={labelId}
        className="block text-sm font-medium text-[var(--text-secondary)]"
      >
        {label}
      </span>

      {/* Hidden input for FormData integration */}
      {name && (
        <input type="hidden" name={name} value={selected.join(',')} />
      )}

      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-labelledby={labelId}
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        aria-controls={listboxId}
        className={[
          'flex w-full items-center justify-between rounded-md border bg-[var(--bg-input)] px-3 py-2',
          'text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          hasError ? 'border-[var(--danger-border)]' : 'border-[var(--border-input)]',
        ].join(' ')}
      >
        <span className={selected.length === 0 ? 'text-[var(--text-muted)]' : ''}>
          {summaryLabel}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown listbox */}
      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={labelId}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] py-1 shadow-lg"
        >
          {options.map((option, index) => {
            const isSelected = selected.includes(option.value)
            const isFocused = index === focusedIndex
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled}
                onClick={() => {
                  if (!option.disabled) {
                    toggleOption(option.value)
                    setFocusedIndex(index)
                  }
                }}
                onMouseEnter={() => setFocusedIndex(index)}
                className={[
                  'flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm',
                  option.disabled ? 'cursor-not-allowed opacity-40' : '',
                  isFocused ? 'bg-[var(--bg-hover)]' : '',
                  isSelected ? 'text-primary font-medium' : 'text-[var(--text-primary)]',
                ].join(' ')}
              >
                {/* Checkbox visual */}
                <span
                  className={[
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    isSelected
                      ? 'border-primary bg-primary'
                      : 'border-[var(--border-input)] bg-[var(--bg-input)]',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {isSelected && (
                    <svg
                      className="h-3 w-3 text-white"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  )}
                </span>
                {option.label}
              </li>
            )
          })}

          {options.length === 0 && (
            <li className="px-3 py-2 text-sm text-[var(--text-muted)]" aria-disabled="true">
              Sin opciones disponibles
            </li>
          )}
        </ul>
      )}

      {/* Error message */}
      {hasError && (
        <p id={errorId} role="alert" className="text-sm text-[var(--danger-text)] mt-1">
          {error}
        </p>
      )}
    </div>
  )
}
