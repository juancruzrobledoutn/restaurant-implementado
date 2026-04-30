/**
 * localStorage helpers with JSON serialization and error handling.
 *
 * All reads/writes are wrapped in try/catch — localStorage may be unavailable
 * (Safari private mode, iOS strict mode, quota exceeded). Callers must never
 * crash the app because of storage failures.
 */
import { logger } from './logger'

function safeGetStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Read and parse a JSON value from localStorage.
 * Returns null if the key is missing, the value is not JSON, or storage fails.
 */
export function readJSON<T>(key: string): T | null {
  const storage = safeGetStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    return JSON.parse(raw) as T
  } catch (err) {
    logger.warn(`storage.readJSON: failed to parse key="${key}"`, err)
    return null
  }
}

/**
 * Serialize and write a value to localStorage.
 * Silently warns and returns false on failure (quota, unavailable storage, etc).
 */
export function writeJSON(key: string, value: unknown): boolean {
  const storage = safeGetStorage()
  if (!storage) return false

  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch (err) {
    logger.warn(`storage.writeJSON: failed for key="${key}"`, err)
    return false
  }
}

/**
 * Remove a key from localStorage. Silent on failure.
 */
export function removeKey(key: string): void {
  const storage = safeGetStorage()
  if (!storage) return

  try {
    storage.removeItem(key)
  } catch (err) {
    logger.warn(`storage.removeKey: failed for key="${key}"`, err)
  }
}
