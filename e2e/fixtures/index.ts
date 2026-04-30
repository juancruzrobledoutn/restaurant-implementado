/**
 * Extended `test` and `expect` for all E2E specs.
 *
 * Import from here instead of '@playwright/test' to get the `seed` fixture.
 *
 * Usage:
 *   import { test, expect } from '../../fixtures'
 *
 *   test('my spec', async ({ page, seed }) => { ... })
 */
import { test as base, expect } from '@playwright/test'
import { createSeed, type SeedResult } from './seed'

type E2EFixtures = {
  /** Per-spec-file seed — created once and reused across all tests in the same file */
  seed: SeedResult
}

// Each test gets its own seed with a unique tag so tables never collide.
// ApiHelper.tokenCache deduplicates actual logins — each email only logs in once
// per suite run, so seed creation is cheap (just API calls, no repeated auth).

export const test = base.extend<E2EFixtures>({
  seed: async ({ request }, use, testInfo) => {
    const tag = `w${testInfo.workerIndex}-${Date.now()}`
    const seedData = await createSeed(request, tag)
    await use(seedData)
    // No teardown — each run uses a unique tag so old data doesn't interfere.
  },
})

export { expect }
