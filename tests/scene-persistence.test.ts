import test from 'node:test'
import assert from 'node:assert/strict'
import { asNodeId, createCanvasStore, storeToJSON } from '@canvas-harness/core'
import { loadCanvasScene, saveCanvasScene } from '../src/client/scene-persistence.js'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key: string) { return values.get(key) ?? null },
    key(index: number) { return [...values.keys()][index] ?? null },
    removeItem(key: string) { values.delete(key) },
    setItem(key: string, value: string) { values.set(key, String(value)) },
  }
}

test('scene persistence falls back to localStorage and restores image data when IndexedDB is unavailable', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const storage = memoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

  try {
    const store = createCanvasStore()
    store.addNode({
      id: asNodeId('image-persisted'),
      type: 'image',
      x: 40,
      y: 80,
      w: 320,
      h: 240,
      angle: 0,
      groups: [],
      data: {
        src: 'data:image/png;base64,aGVsbG8=',
        naturalW: 320,
        naturalH: 240,
        alt: 'reference.png',
      },
    })

    await saveCanvasScene('fallback-session', storeToJSON(store))
    assert.ok(storage.getItem('dsh:infinite-canvas:fallback-session'))

    const restoredScene = await loadCanvasScene('fallback-session')
    assert.ok(restoredScene)
    const restored = createCanvasStore({ initial: restoredScene })
    const image = restored.getNode(asNodeId('image-persisted'))
    assert.equal(image?.type, 'image')
    assert.deepEqual(image?.data, {
      src: 'data:image/png;base64,aGVsbG8=',
      naturalW: 320,
      naturalH: 240,
      alt: 'reference.png',
    })
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: Storage }).localStorage
  }
})
