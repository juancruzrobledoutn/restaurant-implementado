/**
 * idb.ts — typed wrapper over the `idb` library for pwaWaiter.
 *
 * Provides a minimal surface area (openDB, put, getAll, deleteEntry, count,
 * clear) sufficient for the retryQueueStore. All operations are Promise-based.
 *
 * Usage:
 *   const db = await openWaiterDB('waiter-retry-queue', 1, upgrade)
 *   await put(db, 'retry-ops', entry)
 *   const all = await getAll<RetryEntry>(db, 'retry-ops')
 */

import { openDB as idbOpenDB } from 'idb'
import type { IDBPDatabase, DBSchema } from 'idb'

export type { IDBPDatabase, DBSchema }
export { idbOpenDB as openDB }

/**
 * Put (upsert) a value under a given key in a store.
 * `key` must match the store's keyPath or be the out-of-line key.
 */
export async function put<T>(
  db: IDBPDatabase,
  storeName: string,
  value: T,
): Promise<void> {
  await db.put(storeName, value)
}

/**
 * Delete a single entry by its key.
 */
export async function deleteEntry(
  db: IDBPDatabase,
  storeName: string,
  key: string,
): Promise<void> {
  await db.delete(storeName, key)
}

/**
 * Retrieve all entries from the given object store.
 */
export async function getAll<T>(
  db: IDBPDatabase,
  storeName: string,
): Promise<T[]> {
  return db.getAll(storeName) as Promise<T[]>
}

/**
 * Count entries in the object store.
 */
export async function count(
  db: IDBPDatabase,
  storeName: string,
): Promise<number> {
  return db.count(storeName)
}

/**
 * Clear all entries from the object store.
 */
export async function clear(
  db: IDBPDatabase,
  storeName: string,
): Promise<void> {
  await db.clear(storeName)
}
