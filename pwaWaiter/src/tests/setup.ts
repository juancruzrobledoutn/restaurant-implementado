/**
 * Vitest global setup for pwaWaiter.
 *
 * - Enables `expect(...).toBeInTheDocument()` and friends
 * - Starts the MSW server for all tests (reset between tests)
 */
import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './mocks/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
