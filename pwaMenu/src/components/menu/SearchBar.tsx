/**
 * SearchBar — debounced search input using useDeferredValue (React 19).
 * Calls onSearch with deferred value to avoid blocking fast typing.
 */
import { useState, useDeferredValue, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface SearchBarProps {
  onSearch: (query: string) => void
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const deferred = useDeferredValue(value)

  useEffect(() => {
    onSearch(deferred)
  }, [deferred, onSearch])

  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('menu.search')}
        className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
        aria-label={t('menu.search')}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-4 h-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    </div>
  )
}
