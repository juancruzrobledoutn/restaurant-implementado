/**
 * Tests for Table component.
 *
 * Skill: test-driven-development, dashboard-crud-page
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Table, type TableColumn } from './Table'

interface TestItem {
  id: string
  name: string
  status: string
}

const columns: TableColumn<TestItem>[] = [
  { key: 'name', label: 'Nombre', render: (item) => item.name },
  { key: 'status', label: 'Estado', render: (item) => item.status },
]

const items: TestItem[] = [
  { id: '1', name: 'Category A', status: 'Active' },
  { id: '2', name: 'Category B', status: 'Inactive' },
]

describe('Table', () => {
  it('renders column headers', () => {
    render(<Table columns={columns} items={items} rowKey={(i) => i.id} />)
    expect(screen.getByText('Nombre')).toBeInTheDocument()
    expect(screen.getByText('Estado')).toBeInTheDocument()
  })

  it('renders item rows', () => {
    render(<Table columns={columns} items={items} rowKey={(i) => i.id} />)
    expect(screen.getByText('Category A')).toBeInTheDocument()
    expect(screen.getByText('Category B')).toBeInTheDocument()
  })

  it('shows empty message when no items', () => {
    render(
      <Table
        columns={columns}
        items={[]}
        rowKey={(i) => i.id}
        emptyMessage="No hay categorías."
      />
    )
    expect(screen.getByText('No hay categorías.')).toBeInTheDocument()
  })

  it('calls onRowClick when a row is clicked', async () => {
    const onRowClick = vi.fn()
    render(<Table columns={columns} items={items} rowKey={(i) => i.id} onRowClick={onRowClick} />)
    await userEvent.click(screen.getByText('Category A'))
    expect(onRowClick).toHaveBeenCalledWith(items[0])
  })
})
