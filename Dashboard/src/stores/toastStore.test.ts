/**
 * toastStore unit tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useToastStore, toast } from './toastStore'

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('toast module-level API', () => {
  it('toast.success adds a success toast', () => {
    toast.success('It worked')
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe('It worked')
    expect(toasts[0]!.variant).toBe('success')
    expect(typeof toasts[0]!.id).toBe('string')
  })

  it('toast.error adds an error toast', () => {
    toast.error('Something failed')
    const { toasts } = useToastStore.getState()
    expect(toasts[0]!.variant).toBe('error')
  })

  it('toast.info adds an info toast', () => {
    toast.info('FYI')
    const { toasts } = useToastStore.getState()
    expect(toasts[0]!.variant).toBe('info')
  })

  it('multiple toasts accumulate', () => {
    toast.success('A')
    toast.error('B')
    toast.info('C')
    expect(useToastStore.getState().toasts).toHaveLength(3)
  })
})

describe('dismiss', () => {
  it('dismiss removes by id', () => {
    toast.success('To be dismissed')
    const id = useToastStore.getState().toasts[0]!.id
    useToastStore.getState().dismiss(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('dismiss with unknown id does not throw', () => {
    toast.success('Stays')
    useToastStore.getState().dismiss('nonexistent-id')
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })
})

describe('auto-dismiss', () => {
  it('toast is removed after AUTO_DISMISS_MS', () => {
    toast.success('Auto remove me')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.runAllTimers()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
