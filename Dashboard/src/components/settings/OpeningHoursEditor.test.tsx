/**
 * Tests for OpeningHoursEditor (C-28, task 13.5).
 *
 * Coverage:
 * - Renders all 7 day rows
 * - Closed days show no time inputs
 * - Opening a day adds a default interval
 * - Closing a day removes all intervals and calls onChange
 * - Add interval button appends a new interval
 * - Remove interval button removes the correct interval
 * - 24h shortcut sets 00:00 - 24:00
 *
 * Skill: test-driven-development
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpeningHoursEditor } from './OpeningHoursEditor'
import { emptyOpeningHoursWeek } from '@/types/settings'
import type { OpeningHoursWeek } from '@/types/settings'

function makeWeekWithMonday(): OpeningHoursWeek {
  return {
    ...emptyOpeningHoursWeek(),
    mon: [{ open: '09:00', close: '18:00' }],
  }
}

describe('OpeningHoursEditor', () => {
  it('renders 7 day rows', () => {
    render(<OpeningHoursEditor value={null} onChange={vi.fn()} />)
    // Day labels
    expect(screen.getByText('Lunes')).toBeInTheDocument()
    expect(screen.getByText('Martes')).toBeInTheDocument()
    expect(screen.getByText('Miércoles')).toBeInTheDocument()
    expect(screen.getByText('Jueves')).toBeInTheDocument()
    expect(screen.getByText('Viernes')).toBeInTheDocument()
    expect(screen.getByText('Sábado')).toBeInTheDocument()
    expect(screen.getByText('Domingo')).toBeInTheDocument()
  })

  it('shows "Cerrado" for all days when value is null', () => {
    render(<OpeningHoursEditor value={null} onChange={vi.fn()} />)
    const closedLabels = screen.getAllByText('Cerrado')
    expect(closedLabels).toHaveLength(7)
  })

  it('shows "Abierto" for days with intervals', () => {
    render(<OpeningHoursEditor value={makeWeekWithMonday()} onChange={vi.fn()} />)
    expect(screen.getByText('Abierto')).toBeInTheDocument()
  })

  it('toggling a closed day calls onChange with a default interval', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<OpeningHoursEditor value={null} onChange={onChange} />)

    // The first checkbox is Monday
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0]!) // open Monday

    expect(onChange).toHaveBeenCalledOnce()
    const called = onChange.mock.calls[0]![0] as OpeningHoursWeek
    expect(called.mon).toHaveLength(1)
    expect(called.mon[0]).toMatchObject({ open: expect.any(String), close: expect.any(String) })
  })

  it('toggling an open day calls onChange with empty intervals', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<OpeningHoursEditor value={makeWeekWithMonday()} onChange={onChange} />)

    const checkboxes = screen.getAllByRole('checkbox')
    // Monday is checked — uncheck it
    await user.click(checkboxes[0]!)

    expect(onChange).toHaveBeenCalledOnce()
    const called = onChange.mock.calls[0]![0] as OpeningHoursWeek
    expect(called.mon).toHaveLength(0)
  })

  it('24h button sets 00:00 - 24:00 interval', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<OpeningHoursEditor value={makeWeekWithMonday()} onChange={onChange} />)

    const button24h = screen.getByRole('button', { name: /24h/i })
    await user.click(button24h)

    expect(onChange).toHaveBeenCalledOnce()
    const called = onChange.mock.calls[0]![0] as OpeningHoursWeek
    expect(called.mon).toHaveLength(1)
    expect(called.mon[0]).toEqual({ open: '00:00', close: '24:00' })
  })

  it('add interval button appends a new interval', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<OpeningHoursEditor value={makeWeekWithMonday()} onChange={onChange} />)

    const addBtn = screen.getByRole('button', { name: /agregar intervalo para lunes/i })
    await user.click(addBtn)

    expect(onChange).toHaveBeenCalledOnce()
    const called = onChange.mock.calls[0]![0] as OpeningHoursWeek
    expect(called.mon).toHaveLength(2)
  })

  it('remove interval button removes the correct interval', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const value: OpeningHoursWeek = {
      ...emptyOpeningHoursWeek(),
      mon: [
        { open: '09:00', close: '12:00' },
        { open: '14:00', close: '18:00' },
      ],
    }
    render(<OpeningHoursEditor value={value} onChange={onChange} />)

    const removeBtn = screen.getByRole('button', { name: /quitar intervalo 1 de lunes/i })
    await user.click(removeBtn)

    expect(onChange).toHaveBeenCalledOnce()
    const called = onChange.mock.calls[0]![0] as OpeningHoursWeek
    expect(called.mon).toHaveLength(1)
    expect(called.mon[0]).toEqual({ open: '14:00', close: '18:00' })
  })

  it('does not show remove button when only one interval', () => {
    render(<OpeningHoursEditor value={makeWeekWithMonday()} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /quitar intervalo 1/i })).not.toBeInTheDocument()
  })
})
