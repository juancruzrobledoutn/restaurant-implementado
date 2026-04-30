/**
 * idempotency.ts — client-side idempotency key helpers.
 *
 * Each write operation that hits the backend (createRound, confirmRound,
 * ackServiceCall, etc.) must carry an `Idempotency-Key` header with a
 * client-generated UUID so the server can deduplicate retries.
 *
 * Usage:
 *   const clientOpId = generateClientOpId()
 *   await createWaiterRound(sessionId, payload, clientOpId)
 */

/**
 * Generate a new client operation ID (UUID v4).
 * Uses `crypto.randomUUID()` which is available in all modern browsers
 * and Node.js 15+ (Vitest/jsdom also supports it).
 */
export function generateClientOpId(): string {
  return crypto.randomUUID()
}
