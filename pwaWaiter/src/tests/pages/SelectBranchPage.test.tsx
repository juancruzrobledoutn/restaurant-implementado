/**
 * SelectBranchPage tests — list render and navigation on selection.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

import SelectBranchPage from '@/pages/SelectBranchPage'
import { useBranchSelectionStore } from '@/stores/branchSelectionStore'

describe('SelectBranchPage', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    useBranchSelectionStore.getState().clearSelection()
  })

  it('renders the list of branches from the backend', async () => {
    render(
      <MemoryRouter>
        <SelectBranchPage />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('button', { name: /Buen Sabor Centro/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Buen Sabor Palermo/ }),
    ).toBeInTheDocument()
  })

  it('selects a branch and navigates to /login', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SelectBranchPage />
      </MemoryRouter>,
    )

    const btn = await screen.findByRole('button', { name: /Buen Sabor Centro/ })
    await user.click(btn)

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true })
    })
    const state = useBranchSelectionStore.getState()
    expect(state.branchId).toBe('1')
    expect(state.branchName).toBe('Buen Sabor Centro')
    expect(state.branchSlug).toBe('centro')
  })
})
