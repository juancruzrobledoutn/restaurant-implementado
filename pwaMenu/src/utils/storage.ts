/**
 * Safe localStorage wrappers with error handling for QuotaExceededError and SecurityError.
 * If localStorage is unavailable, operations fail gracefully and log a warning.
 */
import { logger } from './logger'

export function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    return JSON.parse(raw) as T
  } catch (err) {
    logger.warn(`storage.readJSON failed for key "${key}"`, err)
    return null
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    // QuotaExceededError or SecurityError (private browsing iOS)
    logger.warn(`storage.writeJSON failed for key "${key}"`, err)
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch (err) {
    logger.warn(`storage.removeKey failed for key "${key}"`, err)
  }
}
