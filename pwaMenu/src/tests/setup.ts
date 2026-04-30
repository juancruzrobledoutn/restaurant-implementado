/**
 * Vitest global setup.
 * - Imports @testing-library/jest-dom matchers
 * - Sets up MSW server lifecycle (start/reset/stop)
 */
import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './mocks/server'

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})
