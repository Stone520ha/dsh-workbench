import test from 'node:test'
import assert from 'node:assert/strict'
import { imageNodeToPromptPart } from '../src/client/image-context.js'

test('PNG image node converts to DSH prompt image part', () => {
  const part = imageNodeToPromptPart({
    id: 'image-1',
    type: 'image',
    data: {
      src: 'data:image/png;base64,aGVsbG8=',
      naturalW: 320,
      naturalH: 240,
      alt: 'chair-reference.png',
    },
  })

  assert.deepEqual(part, {
    type: 'image',
    mediaType: 'image/png',
    data: 'aGVsbG8=',
    name: 'chair-reference.png',
  })
})

test('JPEG image node converts without an empty name', () => {
  const part = imageNodeToPromptPart({
    id: 'image-2',
    type: 'image',
    data: {
      src: 'data:image/jpeg;base64,/9j/AA==',
      naturalW: 640,
      naturalH: 480,
      alt: '   ',
    },
  })

  assert.deepEqual(part, {
    type: 'image',
    mediaType: 'image/jpeg',
    data: '/9j/AA==',
  })
})

test('non-image nodes are ignored', () => {
  assert.equal(imageNodeToPromptPart({ id: 'note-1', type: 'rect', data: {} }), null)
})

test('malformed persisted image data fails closed', () => {
  assert.throws(() => imageNodeToPromptPart({
    id: 'image-bad',
    type: 'image',
    data: { src: 'https://example.com/image.png' },
  }), /unsupported or malformed data URI/)
})
