/**
 * DateRangePicker — composed of two date + time input pairs.
 *
 * Design decisions (design.md D3):
 * - Zero external dependencies: uses native <input type="date"> + <input type="time">.
 * - Browser renders the native date/time picker (accessible by default on desktop/mobile).
 * - error prop displays a full-range error (e.g. "end must be >= start").
 * - aria-invalid + aria-describedby when error is present.
 * - onChange emits the full { startDate, startTime, endDate, endTime } object each time
 *   any sub-field changes.
 *
 * Reusable for: promotions, sales report filters, waiter assignment time windows.
 *
 * Skill: dashboard-crud-page, interface-design
 */

import { useId } from 'react'

export interface DateRangeValue {
  startDate: string   // "YYYY-MM-DD"
  startTime: string   // "HH:mm"
  endDate: string     // "YYYY-MM-DD"
  endTime: string     // "HH:mm"
}

export interface DateRangePickerProps {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  onChange: (value: DateRangeValue) => void
  error?: string
  labelStart?: string
  labelEnd?: string
  disabled?: boolean
}

export function DateRangePicker({
  startDate,
  startTime,
  endDate,
  endTime,
  onChange,
  error,
  labelStart = 'Inicio',
  labelEnd = 'Fin',
  disabled = false,
}: DateRangePickerProps) {
  const errorId = useId()
  const hasError = Boolean(error)

  function emit(patch: Partial<DateRangeValue>) {
    onChange({ startDate, startTime, endDate, endTime, ...patch })
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Start group */}
        <div className="space-y-1">
          <span className="block text-sm font-medium text-[var(--text-secondary)]">
            {labelStart}
          </span>
          <div className="flex gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => emit({ startDate: e.target.value })}
              disabled={disabled}
              aria-invalid={hasError}
              aria-describedby={hasError ? errorId : undefined}
              className={[
                'flex-1 rounded-md border bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)]',
                'placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary',
                'disabled:cursor-not-allowed disabled:opacity-50',
                hasError ? 'border-[var(--danger-border)]' : 'border-[var(--border-input)]',
              ].join(' ')}
            />
            <input
              type="time"
              value={startTime}
              onChange={(e) => emit({ startTime: e.target.value })}
              disabled={disabled}
              aria-invalid={hasError}
              aria-describedby={hasError ? errorId : undefined}
              className={[
                'w-28 rounded-md border bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)]',
                'placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary',
                'disabled:cursor-not-allowed disabled:opacity-50',
                hasError ? 'border-[var(--danger-border)]' : 'border-[var(--border-input)]',
              ].join(' ')}
            />
          </div>
        </div>

        {/* End group */}
        <div className="space-y-1">
          <span className="block text-sm font-medium text-[var(--text-secondary)]">
            {labelEnd}
          </span>
          <div className="flex gap-2">
            <input
              type="date"
              value={endDate}
              onChange={(e) => emit({ endDate: e.target.value })}
              disabled={disabled}
              aria-invalid={hasError}
              aria-describedby={hasError ? errorId : undefined}
              className={[
                'flex-1 rounded-md border bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)]',
                'placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary',
                'disabled:cursor-not-allowed disabled:opacity-50',
                hasError ? 'border-[var(--danger-border)]' : 'border-[var(--border-input)]',
              ].join(' ')}
            />
            <input
              type="time"
              value={endTime}
              onChange={(e) => emit({ endTime: e.target.value })}
              disabled={disabled}
              aria-invalid={hasError}
              aria-describedby={hasError ? errorId : undefined}
              className={[
                'w-28 rounded-md border bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)]',
                'placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary',
                'disabled:cursor-not-allowed disabled:opacity-50',
                hasError ? 'border-[var(--danger-border)]' : 'border-[var(--border-input)]',
              ].join(' ')}
            />
          </div>
        </div>
      </div>

      {/* Error message */}
      {hasError && (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-[var(--danger-text)] mt-1"
        >
          {error}
        </p>
      )}
    </div>
  )
}
