import { fromSerialized, type Scene, type SerializedScene } from '@canvas-harness/core'

const DB_NAME = 'dsh-infinite-canvas'
const DB_VERSION = 1
const SCENE_STORE = 'scenes'
const LEGACY_PREFIX = 'dsh:infinite-canvas:'

let databasePromise: Promise<IDBDatabase> | undefined
const saveQueues = new Map<string, Promise<void>>()

function legacyKey(sessionId: string): string {
  return `${LEGACY_PREFIX}${sessionId}`
}

function readLegacyRaw(sessionId: string): unknown | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(legacyKey(sessionId))
    return raw ? JSON.parse(raw) as unknown : undefined
  } catch {
    return undefined
  }
}

function removeLegacy(sessionId: string): void {
  try {
    globalThis.localStorage?.removeItem(legacyKey(sessionId))
  } catch {
    // Migration cleanup is optional; a stale legacy copy is harmless.
  }
}

function writeLegacy(sessionId: string, scene: SerializedScene): void {
  globalThis.localStorage?.setItem(legacyKey(sessionId), JSON.stringify(scene))
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SCENE_STORE)) db.createObjectStore(SCENE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open canvas IndexedDB'))
    request.onblocked = () => reject(new Error('Canvas IndexedDB upgrade was blocked'))
  })
  return databasePromise
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function readIndexedDb(sessionId: string): Promise<unknown | undefined> {
  const db = await openDatabase()
  const transaction = db.transaction(SCENE_STORE, 'readonly')
  const request = transaction.objectStore(SCENE_STORE).get(sessionId)
  return requestResult(request)
}

async function writeIndexedDb(sessionId: string, scene: SerializedScene): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SCENE_STORE, 'readwrite')
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Canvas IndexedDB write failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Canvas IndexedDB write aborted'))
    transaction.objectStore(SCENE_STORE).put(scene, sessionId)
  })
}

function decodeScene(raw: unknown): Scene | undefined {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { nodes?: unknown }).nodes)) return undefined
  try {
    return fromSerialized(raw)
  } catch {
    return undefined
  }
}

/** Synchronous legacy seed so old localStorage scenes can paint immediately. */
export function readLegacyScene(sessionId: string): Scene | undefined {
  return decodeScene(readLegacyRaw(sessionId))
}

/**
 * Load the durable scene. IndexedDB wins; an old localStorage scene is migrated
 * on first successful IndexedDB access. When IndexedDB is unavailable, the
 * legacy store remains a best-effort fallback.
 */
export async function loadCanvasScene(sessionId: string): Promise<Scene | undefined> {
  const legacyRaw = readLegacyRaw(sessionId)
  try {
    const durableRaw = await readIndexedDb(sessionId)
    const durable = decodeScene(durableRaw)
    if (durable) return durable

    const legacy = decodeScene(legacyRaw)
    if (!legacy || !legacyRaw) return undefined
    await writeIndexedDb(sessionId, legacyRaw as SerializedScene)
    removeLegacy(sessionId)
    return legacy
  } catch {
    return decodeScene(legacyRaw)
  }
}

/**
 * Save one scene in submission order per Session. IndexedDB is the primary
 * backend so embedded image data URIs are not constrained by localStorage's
 * tiny synchronous quota. localStorage is only a compatibility fallback.
 */
export function saveCanvasScene(sessionId: string, scene: SerializedScene): Promise<void> {
  const previous = saveQueues.get(sessionId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(async () => {
    try {
      await writeIndexedDb(sessionId, scene)
      removeLegacy(sessionId)
    } catch (indexedDbError) {
      try {
        writeLegacy(sessionId, scene)
      } catch (legacyError) {
        const first = indexedDbError instanceof Error ? indexedDbError.message : String(indexedDbError)
        const second = legacyError instanceof Error ? legacyError.message : String(legacyError)
        throw new Error(`Canvas persistence failed (IndexedDB: ${first}; localStorage: ${second})`)
      }
    }
  })
  saveQueues.set(sessionId, next)
  const cleanup = () => {
    if (saveQueues.get(sessionId) === next) saveQueues.delete(sessionId)
  }
  void next.then(cleanup, cleanup)
  return next
}
