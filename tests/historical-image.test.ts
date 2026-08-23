import test from 'node:test'
import assert from 'node:assert/strict'
import {
  historicalAttachmentIdOfCanvasNode,
  historicalImageRefs,
} from '../src/client/historical-image.js'

const png = {
  attachmentId: 'sha256:png',
  mediaType: 'image/png',
  bytes: 1024,
  width: 640,
  height: 480,
  name: 'chair.png',
}

const webp = {
  attachmentId: 'sha256:webp',
  mediaType: 'image/webp',
  bytes: 2048,
  width: 800,
  height: 600,
}

test('user/steering/context chat nodes expose durable image refs', () => {
  assert.deepEqual(historicalImageRefs({
    kind: 'user',
    data: {
      content: [
        { type: 'text', text: 'compare these' },
        { type: 'image', attachment: png },
        { type: 'image', attachment: png },
        { type: 'image', attachment: webp },
      ],
    },
  }), [png, webp])

  assert.deepEqual(historicalImageRefs({
    kind: 'steering',
    data: { content: [{ type: 'image', attachment: png }] },
  }), [png])

  assert.deepEqual(historicalImageRefs({
    kind: 'context',
    data: { content: [{ type: 'image', attachment: webp }] },
  }), [webp])
})

test('assistant-step image blocks expose durable refs and ignore malformed metadata', () => {
  assert.deepEqual(historicalImageRefs({
    kind: 'assistant-step',
    data: {
      blocks: [
        { kind: 'text', text: 'render' },
        { kind: 'image', attachment: png },
        { kind: 'image', attachment: { ...webp, width: 0 } },
        { kind: 'image', attachment: { ...webp, mediaType: 'image/svg+xml' } },
      ],
    },
  }), [png])
})

test('canvas historical image metadata keeps stable DSH attachment identity', () => {
  assert.equal(historicalAttachmentIdOfCanvasNode({
    type: 'image',
    data: { src: 'data:image/png;base64,AA==', dshAttachmentId: 'sha256:png' },
  }), 'sha256:png')
  assert.equal(historicalAttachmentIdOfCanvasNode({ type: 'image', data: { src: 'x' } }), undefined)
  assert.equal(historicalAttachmentIdOfCanvasNode({ type: 'rect', data: { dshAttachmentId: 'sha256:png' } }), undefined)
})
