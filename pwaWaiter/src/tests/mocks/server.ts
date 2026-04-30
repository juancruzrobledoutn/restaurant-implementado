import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/** MSW server shared by all tests. Started by src/tests/setup.ts. */
export const server = setupServer(...handlers)
