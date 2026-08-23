import test from 'node:test'
import assert from 'node:assert/strict'
import {
  asEdgeId,
  asNodeId,
  createCanvasStore,
  fromSerialized,
  getContext,
  storeToJSON,
} from '@canvas-harness/core'

const NODE_COUNT = 250
const EDGE_COUNT = 25

function nodeId(index: number) {
  return asNodeId(`scale-node-${index}`)
}

test('250-node canvas scene survives mutation, AI context, and persistence round-trip', () => {
  const store = createCanvasStore()

  store.batch(() => {
    for (let index = 0; index < NODE_COUNT; index++) {
      store.addNode({
        id: nodeId(index),
        type: 'rect',
        x: (index % 10) * 280,
        y: Math.floor(index / 10) * 160,
        w: 240,
        h: 112,
        angle: 0,
        groups: [],
        content: `Scale node ${index}`,
        data: { localKind: 'scale-smoke', index },
        style: { autoFit: true },
      })
    }

    for (let index = 0; index < EDGE_COUNT; index++) {
      store.addEdge({
        id: asEdgeId(`scale-edge-${index}`),
        source: { nodeId: nodeId(index), localOffset: { x: 240, y: 56 } },
        target: { nodeId: nodeId(index + 1), localOffset: { x: 0, y: 56 } },
        pathStyle: 'bezier',
        groups: [],
      })
    }
  })

  assert.equal(store.getNodeCount(), NODE_COUNT)
  assert.equal(store.getAllEdges().length, EDGE_COUNT)

  for (let index = 0; index < 50; index += 2) {
    const current = store.getNode(nodeId(index))
    assert.ok(current)
    store.updateNode(nodeId(index), { x: current.x + 17, y: current.y + 9 })
  }

  const selected = [0, 49, 99, 149, 199, 249].map(nodeId)
  store.setSelection(selected)
  const context = String(getContext(store, {
    format: 'markdown',
    selectionOnly: true,
    maxNodes: 100,
  }))

  for (const index of [0, 49, 99, 149, 199, 249]) {
    assert.match(context, new RegExp(`Scale node ${index}`))
  }

  const serialized = storeToJSON(store)
  assert.equal(serialized.nodes.length, NODE_COUNT)
  assert.equal(serialized.edges.length, EDGE_COUNT)

  const restored = createCanvasStore({ initial: fromSerialized(serialized) })
  assert.equal(restored.getNodeCount(), NODE_COUNT)
  assert.equal(restored.getAllEdges().length, EDGE_COUNT)
  assert.deepEqual(restored.getSelection(), selected)
  assert.equal(restored.getNode(nodeId(249))?.content, 'Scale node 249')
  assert.equal(restored.getNode(nodeId(0))?.x, 17)
  assert.equal(restored.getNode(nodeId(0))?.y, 9)
})
