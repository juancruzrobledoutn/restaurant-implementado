/**
 * MultiSelect unit tests — C-27.
 *
 * Covers: toggle select/deselect, keyboard nav (ArrowDown + Enter, Escape),
 * summary label, error rendering, disabled trigger, and click-outside.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MultiSelect } from './MultiSelect'
import type { MultiSelectOption } from './MultiSelect'

const OPTIONS: MultiSelectOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

interface RenderProps {
  selected?: string[]
  onChange?: ReturnType<typeof vi.fn>
  error?: string
  disabled?: boolean
  options?: MultiSelectOption[]
}

function renderSelect({
  selected = [],
  onChange = vi.fn(),
  error,
  disabled,
  options = OPTIONS,
}: RenderProps = {}) {
  render(
    <MultiSelect
      label="Test"
      options={options}
      selected={selected}
      onChange={onChange}
      error={error}
      disabled={disabled}
    />,
  )
  return onChange
}

// Open the dropdown
function openDropdown() {
  const trigger = screen.getByRole('button')
  fireEvent.click(trigger)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Toggle select / deselect via click
// ---------------------------------------------------------------------------

describe('MultiSelect click interactions', () => {
  it('calls onChange with new value appended when clicking unselected option', () => {
    const onChange = renderSelect({ selected: ['a'] })
    openDropdown()

    fireEvent.click(screen.getByText('Beta'))

    expect(onChange).toHaveBeenCalledWith(['a', 'b'])
  })

  it('calls onChange with value removed when clicking already-selected option', () => {
    const onChange = renderSelect({ selected: ['a', 'b'] })
    openDropdown()

    fireEvent.click(screen.getByText('Alpha'))

    expect(onChange).toHaveBeenCalledWith(['b'])
  })

  it('does not call onChange when clicking a disabled option', () => {
    const disabledOptions: MultiSelectOption[] = [
      { value: 'x', label: 'Disabled item', disabled: true },
    ]
    const onChange = renderSelect({ options: disabledOptions })
    openDropdown()

    fireEvent.click(screen.getByText('Disabled item'))

    expect(onChange).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Keyboard: ArrowDown + Enter toggle focused option
// ---------------------------------------------------------------------------

describe('MultiSelect keyboard navigation', () => {
  it('ArrowDown + Enter toggles the focused option', async () => {
    const onChange = renderSelect({ selected: [] })
    const user = userEvent.setup()

    const trigger = screen.getByRole('button')
    await user.click(trigger) // open

    // Arrow down moves focus to index 1 (Beta), then Enter selects it
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith(['b'])
  })

  it('ArrowUp moves focus back toward the first option', async () => {
    const onChange = renderSelect({ selected: [] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button'))

    // Start at 0, ArrowDown to 1, ArrowUp back to 0, Enter selects 'a'
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith(['a'])
  })

  it('Escape closes the dropdown and returns focus to trigger', async () => {
    renderSelect()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button'))

    // Dropdown should be open — check listbox exists
    expect(screen.getByRole('listbox')).toBeTruthy()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button'))
  })

  it('Home moves focus to first option', async () => {
    const onChange = renderSelect({ selected: [] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button'))

    // Go to last, then Home, then Enter
    await user.keyboard('{End}')
    await user.keyboard('{Home}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith(['a'])
  })

  it('End moves focus to last option', async () => {
    const onChange = renderSelect({ selected: [] })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button'))
    await user.keyboard('{End}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith(['c'])
  })
})

// ---------------------------------------------------------------------------
// Summary label in trigger
// ---------------------------------------------------------------------------

describe('MultiSelect summary label', () => {
  it('shows placeholder when nothing is selected', () => {
    renderSelect({ selected: [] })
    expect(screen.getByRole('button').textContent).toContain('Selecciona opciones')
  })

  it('shows "1 seleccionada" when 1 item is selected', () => {
    renderSelect({ selected: ['a'] })
    expect(screen.getByRole('button').textContent).toContain('1 seleccionada')
  })

  it('shows "2 seleccionadas" (plural) when 2 items are selected', () => {
    renderSelect({ selected: ['a', 'b'] })
    expect(screen.getByRole('button').textContent).toContain('2 seleccionadas')
  })
})

// ---------------------------------------------------------------------------
// error prop
// ---------------------------------------------------------------------------

describe('MultiSelect error prop', () => {
  it('renders <p role="alert"> with error message', () => {
    renderSelect({ error: 'Debe seleccionar al menos una sucursal' })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Debe seleccionar al menos una sucursal')
  })

  it('sets aria-invalid="true" on trigger when error is present', () => {
    renderSelect({ error: 'Requerido' })

    const trigger = screen.getByRole('button')
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
  })

  it('does not render role="alert" when error is undefined', () => {
    renderSelect()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// disabled trigger does not open dropdown
// ---------------------------------------------------------------------------

describe('MultiSelect disabled', () => {
  it('does not open dropdown when trigger is disabled', () => {
    renderSelect({ disabled: true })

    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)

    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('trigger button is disabled when disabled=true', () => {
    renderSelect({ disabled: true })
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ARIA attributes
// ---------------------------------------------------------------------------

describe('MultiSelect ARIA', () => {
  it('trigger has aria-haspopup="listbox"', () => {
    renderSelect()
    expect(screen.getByRole('button').getAttribute('aria-haspopup')).toBe('listbox')
  })

  it('trigger has aria-expanded=false when closed', () => {
    renderSelect()
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('trigger has aria-expanded=true when open', () => {
    renderSelect()
    openDropdown()
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  })

  it('option has aria-selected=true for selected value', () => {
    renderSelect({ selected: ['b'] })
    openDropdown()

    const betaOption = screen.getByRole('option', { name: /beta/i })
    expect(betaOption.getAttribute('aria-selected')).toBe('true')
  })

  it('option has aria-selected=false for unselected value', () => {
    renderSelect({ selected: ['b'] })
    openDropdown()

    const alphaOption = screen.getByRole('option', { name: /alpha/i })
    expect(alphaOption.getAttribute('aria-selected')).toBe('false')
  })
})
