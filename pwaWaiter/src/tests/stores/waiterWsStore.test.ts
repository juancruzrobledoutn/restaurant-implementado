/**
 * waiterWsStore tests — primitive selectors and action mutations.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  useWaiterWsStore,
  selectIsConnected,
  selectReconnectAttempts,
} from '@/stores/waiterWsStore'

describe('waiterWsStore', () => {
  beforeEach(() => {
    useWaiterWsStore.setState({ isConnected: false, reconnectAttempts: 0 })
  })

  it('_setConnected mutates isConnected', () => {
    useWaiterWsStore.getState()._setConnected(true)
    expect(selectIsConnected(useWaiterWsStore.getState())).toBe(true)
    useWaiterWsStore.getState()._setConnected(false)
    expect(selectIsConnected(useWaiterWsStore.getState())).toBe(false)
  })

  it('_incrementReconnect bumps reconnectAttempts', () => {
    useWaiterWsStore.getState()._incrementReconnect()
    useWaiterWsStore.getState()._incrementReconnect()
    expect(selectReconnectAttempts(useWaiterWsStore.getState())).toBe(2)
  })

  it('_resetReconnect zeros reconnectAttempts', () => {
    useWaiterWsStore.setState({ reconnectAttempts: 10 })
    useWaiterWsStore.getState()._resetReconnect()
    expect(selectReconnectAttempts(useWaiterWsStore.getState())).toBe(0)
  })
})
