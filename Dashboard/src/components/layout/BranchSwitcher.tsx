/**
 * BranchSwitcher — branch selector for the Navbar (C-29).
 *
 * Design intent:
 * - Lives in the center of the bg-gray-900 Navbar (h-14)
 * - Quiet affordance: name + chevron, no heavy border — coherent with dark chrome
 * - Single branch: static display (no dropdown — no choice to make)
 * - Multiple branches: dropdown with keyboard-accessible listbox
 * - Loading: animated skeleton — no layout shift
 *
 * Skills: zustand-store-pattern, vercel-react-best-practices, interface-design
 *
 * Patterns:
 * - useRef + mousedown listener for outside-click close
 * - Plain selectors for primitives; inline for single actions
 * - No destructuring from store
 */

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Building2 } from 'lucide-react'
import {
  useBranchStore,
  selectBranches,
  selectSelectedBranch,
  selectIsLoadingBranches,
  selectSetSelectedBranch,
} from '@/stores/branchStore'
import type { Branch } from '@/types/branch'

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function BranchSwitcherSkeleton() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md animate-pulse">
      <div className="h-4 w-4 rounded bg-gray-700" />
      <div className="h-4 w-28 rounded bg-gray-700" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single branch — static display (no dropdown)
// ---------------------------------------------------------------------------

function SingleBranchDisplay({ branch }: { branch: Branch }) {
  const buttonRef = useRef<HTMLButtonElement>(null)

  // C-30: focus the button when CTA from HomeEmptyBranchState fires
  useEffect(() => {
    function handleFocusBranchSwitcher() {
      buttonRef.current?.focus()
    }
    window.addEventListener('dashboard:focus-branch-switcher', handleFocusBranchSwitcher)
    return () => window.removeEventListener('dashboard:focus-branch-switcher', handleFocusBranchSwitcher)
  }, [])

  return (
    <button
      ref={buttonRef}
      type="button"
      className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-white cursor-default"
      aria-label={`Sucursal: ${branch.name}`}
      // Single branch → no action on click; still a button for a11y consistency
    >
      <Building2 className="h-4 w-4 text-gray-400 shrink-0" aria-hidden="true" />
      <span className="max-w-[160px] truncate">{branch.name}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Multi-branch dropdown
// ---------------------------------------------------------------------------

interface BranchDropdownProps {
  branches: Branch[]
  selected: Branch | null
  onSelect: (branch: Branch) => void
}

function BranchDropdown({ branches, selected, onSelect }: BranchDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click (mousedown fires before blur)
  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  // C-30: listen for CustomEvent from HomeEmptyBranchState CTA
  useEffect(() => {
    function handleFocusBranchSwitcher() {
      if (branches.length > 1) {
        setIsOpen(true)
      }
    }
    window.addEventListener('dashboard:focus-branch-switcher', handleFocusBranchSwitcher)
    return () => window.removeEventListener('dashboard:focus-branch-switcher', handleFocusBranchSwitcher)
  }, [branches.length])

  function handleSelect(branch: Branch) {
    onSelect(branch)
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-white hover:bg-gray-700 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={selected ? `Sucursal: ${selected.name}` : 'Seleccionar sucursal'}
      >
        <Building2 className="h-4 w-4 text-gray-400 shrink-0" aria-hidden="true" />
        <span className="max-w-[160px] truncate">
          {selected ? selected.name : (
            <span className="text-gray-400">Seleccionar sucursal</span>
          )}
        </span>
        <ChevronDown
          className={[
            'h-3.5 w-3.5 text-gray-400 transition-transform duration-150 shrink-0',
            isOpen ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown list */}
      {isOpen && (
        <ul
          role="listbox"
          aria-label="Sucursales disponibles"
          className="absolute left-1/2 top-full z-50 mt-1 min-w-[200px] -translate-x-1/2 overflow-hidden rounded-md border border-gray-700 bg-gray-800 shadow-lg shadow-black/40"
        >
          {branches.map((branch) => (
            <li
              key={branch.id}
              role="option"
              aria-selected={selected?.id === branch.id}
              onClick={() => handleSelect(branch)}
              className={[
                'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-colors select-none',
                selected?.id === branch.id
                  ? 'bg-orange-600/20 text-orange-400'
                  : 'text-gray-200 hover:bg-gray-700',
              ].join(' ')}
            >
              <Building2 className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
              <span className="truncate">{branch.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BranchSwitcher — orchestrates loading / single / multi states
// ---------------------------------------------------------------------------

export function BranchSwitcher() {
  const branches = useBranchStore(selectBranches)
  const selectedBranch = useBranchStore(selectSelectedBranch)
  const isLoading = useBranchStore(selectIsLoadingBranches)
  const setSelectedBranch = useBranchStore(selectSetSelectedBranch)

  if (isLoading) {
    return <BranchSwitcherSkeleton />
  }

  // Single branch — no dropdown needed
  if (branches.length === 1 && branches[0]) {
    return <SingleBranchDisplay branch={branches[0]} />
  }

  return (
    <BranchDropdown
      branches={branches}
      selected={selectedBranch}
      onSelect={setSelectedBranch}
    />
  )
}
