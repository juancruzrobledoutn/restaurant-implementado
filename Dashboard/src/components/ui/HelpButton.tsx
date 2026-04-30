/**
 * HelpButton — trigger that opens a help popover/modal.
 *
 * Mandatory in every Dashboard CRUD page (PageContainer) and every modal form.
 *
 * Skill: help-system-content, dashboard-crud-page
 */

import { useState, useRef, useEffect, type ReactNode } from 'react'
import { HelpCircle, X } from 'lucide-react'

type HelpButtonSize = 'sm' | 'md'

interface HelpButtonProps {
  title: string
  content: ReactNode
  size?: HelpButtonSize
}

const sizeClasses: Record<HelpButtonSize, string> = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
}

const iconClasses: Record<HelpButtonSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-5 w-5',
}

export function HelpButton({ title, content, size = 'md' }: HelpButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`Ayuda: ${title}`}
        aria-expanded={isOpen}
        className={[
          'inline-flex items-center justify-center rounded-full',
          'text-gray-400 hover:text-primary hover:bg-primary/10',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          sizeClasses[size],
        ].join(' ')}
      >
        <HelpCircle className={iconClasses[size]} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          role="tooltip"
          className={[
            'absolute z-50 left-0 top-full mt-2 w-80',
            'rounded-xl border border-gray-700 bg-gray-900 shadow-2xl',
            'p-4 text-sm text-gray-300',
          ].join(' ')}
        >
          <div className="flex items-start justify-between mb-3">
            <h3 className="font-semibold text-white">{title}</h3>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Cerrar ayuda"
              className="ml-2 shrink-0 rounded p-0.5 text-gray-400 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {content}
        </div>
      )}
    </div>
  )
}
