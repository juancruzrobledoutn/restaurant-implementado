/**
 * AllergenFilter — toggleable allergen chips.
 * Selecting allergens EXCLUDES products with those allergens.
 */
import { useTranslation } from 'react-i18next'

const ALLERGEN_CODES = [
  'GLUTEN', 'CRUSTACEAN', 'EGG', 'FISH', 'PEANUT', 'SOY',
  'MILK', 'NUTS', 'CELERY', 'MUSTARD', 'SESAME', 'SULPHITE', 'LUPIN', 'MOLLUSC',
] as const

export type AllergenCode = (typeof ALLERGEN_CODES)[number]

interface AllergenFilterProps {
  selected: Set<AllergenCode>
  onToggle: (code: AllergenCode) => void
  onClear: () => void
}

export function AllergenFilter({ selected, onToggle, onClear }: AllergenFilterProps) {
  const { t } = useTranslation()

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">{t('allergen.title')}</span>
        {selected.size > 0 && (
          <button
            onClick={onClear}
            className="text-xs text-primary hover:underline"
          >
            {t('allergen.clear')}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {ALLERGEN_CODES.map((code) => {
          const isSelected = selected.has(code)
          return (
            <button
              key={code}
              onClick={() => onToggle(code)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                isSelected
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-primary'
              }`}
            >
              {t(`allergen.${code}`)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
