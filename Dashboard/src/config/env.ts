/**
 * Typed access to Vite environment variables.
 * All variables must be prefixed with VITE_ to be exposed to the client.
 */

function requireEnv(key: string): string {
  const value = import.meta.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value as string
}

export const env = {
  /** Backend API base URL — e.g. http://localhost:8000 (no trailing slash, no /api) */
  API_URL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  /** WebSocket gateway URL — e.g. ws://localhost:8001 */
  WS_URL: import.meta.env.VITE_WS_URL ?? 'ws://localhost:8001',
} as const

/** Use when the variable is strictly required and absence is a fatal error. */
export { requireEnv }
