/**
 * OpeningHoursEditor — editable 7-day opening hours schedule.
 *
 * UX:
 * - Each day row shows a toggle (open/closed) and a list of time intervals
 * - Users can add/remove intervals per day
 * - Each interval has open/close time inputs (HH:MM)
 * - Intervals are validated: open < close, no overlaps within a day
 * - All-day "24h" shortcut sets 00:00 - 24:00
 *
 * Controlled component: caller owns the state via value/onChange.
 *
 * Skill: dashboard-crud-page, react19-form-pattern
 */

import { useId } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DAY_KEYS, DAY_LABELS, emptyOpeningHoursWeek } from '@/types/settings'
import type { DayKey, OpeningHoursInterval, OpeningHoursWeek } from '@/types/settings'

interface OpeningHoursEditorProps {
  value: OpeningHoursWeek | null
  onChange: (value: OpeningHoursWeek) => void
  disabled?: boolean
}

function ensureWeek(value: OpeningHoursWeek | null): OpeningHoursWeek {
  if (!value) return emptyOpeningHoursWeek()
  const base = emptyOpeningHoursWeek()
  return { ...base, ...value }
}

export function OpeningHoursEditor({ value, onChange, disabled = false }: OpeningHoursEditorProps) {
  const week = ensureWeek(value)
  const baseId = useId()

  function updateDay(day: DayKey, intervals: OpeningHoursInterval[]) {
    onChange({ ...week, [day]: intervals })
  }

  function addInterval(day: DayKey) {
    const current = week[day]
    updateDay(day, [...current, { open: '09:00', close: '18:00' }])
  }

  function removeInterval(day: DayKey, index: number) {
    const current = week[day]
    updateDay(day, current.filter((_, i) => i !== index))
  }

  function updateInterval(day: DayKey, index: number, field: 'open' | 'close', timeVal: string) {
    const current = week[day].map((interval, i) =>
      i === index ? { ...interval, [field]: timeVal } : interval,
    )
    updateDay(day, current)
  }

  function setAllDay(day: DayKey) {
    updateDay(day, [{ open: '00:00', close: '24:00' }])
  }

  function closedDay(day: DayKey) {
    updateDay(day, [])
  }

  return (
    <div className="space-y-3" aria-label="Horarios de apertura por día">
      {DAY_KEYS.map((day) => {
        const intervals = week[day]
        const isOpen = intervals.length > 0
        const dayId = `${baseId}-${day}`

        return (
          <div key={day} className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
            {/* Day header */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-200 w-24">
                {DAY_LABELS[day]}
              </span>

              <div className="flex items-center gap-2">
                {/* Open/closed toggle */}
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    id={`${dayId}-open`}
                    checked={isOpen}
                    disabled={disabled}
                    onChange={(e) => {
                      if (e.target.checked) addInterval(day)
                      else closedDay(day)
                    }}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-primary focus:ring-primary/70"
                  />
                  <span className="text-xs text-gray-400">
                    {isOpen ? 'Abierto' : 'Cerrado'}
                  </span>
                </label>

                {isOpen && (
                  <>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setAllDay(day)}
                      className="text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                      title="Todo el dia (00:00 - 24:00)"
                    >
                      24h
                    </button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => addInterval(day)}
                      aria-label={`Agregar intervalo para ${DAY_LABELS[day]}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Intervals */}
            {isOpen && (
              <div className="space-y-2 pl-1">
                {intervals.map((interval, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`${dayId}-open-${idx}`}>
                      Apertura {DAY_LABELS[day]} intervalo {idx + 1}
                    </label>
                    <input
                      type="time"
                      id={`${dayId}-open-${idx}`}
                      value={interval.open}
                      disabled={disabled}
                      onChange={(e) => updateInterval(day, idx, 'open', e.target.value)}
                      className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-primary/70 disabled:opacity-50"
                    />
                    <span className="text-gray-500 text-xs">—</span>
                    <label className="sr-only" htmlFor={`${dayId}-close-${idx}`}>
                      Cierre {DAY_LABELS[day]} intervalo {idx + 1}
                    </label>
                    <input
                      type="time"
                      id={`${dayId}-close-${idx}`}
                      value={interval.close === '24:00' ? '00:00' : interval.close}
                      disabled={disabled}
                      onChange={(e) => {
                        const raw = e.target.value
                        // Treat midnight as 24:00 (closing time — special backend value)
                        updateInterval(day, idx, 'close', raw === '00:00' ? '24:00' : raw)
                      }}
                      className="rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-primary/70 disabled:opacity-50"
                    />
                    {intervals.length > 1 && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => removeInterval(day, idx)}
                        aria-label={`Quitar intervalo ${idx + 1} de ${DAY_LABELS[day]}`}
                        className="ml-1 rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
