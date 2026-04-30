/**
 * OrderFilters — sticky filter header for the Orders page (C-25).
 *
 * Controlled inputs driven by RoundFilters from the store.
 * table_code has 300ms debounce to avoid rapid API calls.
 *
 * Skill: dashboard-crud-page, vercel-react-best-practices
 */

import { useEffect, useRef, useCallback } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { useSectorStore, selectSectors } from '@/stores/sectorStore'
import type { RoundFilters, RoundStatus } from '@/types/operations'
import type { SelectOption } from '@/components/ui/Select'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: SelectOption[] = [
  { value: '',          label: 'Todos los estados' },
  { value: 'PENDING',   label: 'Pendiente' },
  { value: 'CONFIRMED', label: 'Confirmada' },
  { value: 'SUBMITTED', label: 'Enviada' },
  { value: 'IN_KITCHEN', label: 'En cocina' },
  { value: 'READY',     label: 'Lista' },
  { value: 'SERVED',    label: 'Servida' },
  { value: 'CANCELED',  label: 'Cancelada' },
]

const DEBOUNCE_MS = 300

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OrderFiltersProps {
  filters: RoundFilters
  onFilterChange: <K extends keyof RoundFilters>(key: K, value: RoundFilters[K] | undefined) => void
  onClear: () => void
  onRefresh: () => void
  isLoading: boolean
}

export function OrderFilters({
  filters,
  onFilterChange,
  onClear,
  onRefresh,
  isLoading,
}: OrderFiltersProps) {
  const sectors = useSectorStore(selectSectors)

  const sectorOptions: SelectOption[] = [
    { value: '', label: 'Todos los sectores' },
    ...sectors.map((s) => ({ value: s.id, label: s.name })),
  ]

  // ── table_code debounce ──────────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleTableCode = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onFilterChange('table_code', value || undefined)
      }, DEBOUNCE_MS)
    },
    [onFilterChange],
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <div
      className="sticky top-0 z-20 bg-gray-900 border-b border-gray-700 px-4 py-3"
      role="search"
      aria-label="Filtros de rondas"
    >
      <div className="flex flex-wrap items-end gap-3">
        {/* Date */}
        <div className="min-w-[140px]">
          <Input
            type="date"
            label="Fecha"
            value={filters.date ?? ''}
            onChange={(e) => onFilterChange('date', e.target.value || undefined)}
            aria-label="Filtrar por fecha"
          />
        </div>

        {/* Sector */}
        <div className="min-w-[160px] flex-1">
          <Select
            label="Sector"
            value={filters.sector_id ?? ''}
            options={sectorOptions}
            onChange={(e) =>
              onFilterChange('sector_id', e.target.value || undefined)
            }
            aria-label="Filtrar por sector"
          />
        </div>

        {/* Status */}
        <div className="min-w-[160px] flex-1">
          <Select
            label="Estado"
            value={filters.status ?? ''}
            options={STATUS_OPTIONS}
            onChange={(e) =>
              onFilterChange('status', (e.target.value as RoundStatus) || undefined)
            }
            aria-label="Filtrar por estado"
          />
        </div>

        {/* Table code */}
        <div className="min-w-[140px] flex-1">
          <Input
            label="Mesa"
            defaultValue={filters.table_code ?? ''}
            onChange={(e) => handleTableCode(e.target.value)}
            placeholder="Buscar mesa..."
            aria-label="Buscar por código de mesa"
          />
        </div>

        {/* Actions */}
        <div className="flex items-end gap-2 pb-[1px]">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            aria-label="Limpiar filtros"
            title="Limpiar filtros"
          >
            <X className="w-4 h-4 mr-1" aria-hidden="true" />
            Limpiar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            isLoading={isLoading}
            aria-label="Refrescar resultados"
            title="Refrescar"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  )
}
