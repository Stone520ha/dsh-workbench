export type CanvasPromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg'; data: string; name?: string }

export interface CanvasImageNodeLike {
  readonly id: string
  readonly type: string
  readonly data?: unknown
}

interface ImageNodeDataLike {
  readonly src?: unknown
  readonly alt?: unknown
}

/**
 * Convert one canvas-harness image node into DSH's public prompt-image wire shape.
 *
 * Canvas images are self-contained PNG/JPEG data URIs. DSH expects the same
 * media type plus base64 bytes without the URI prefix. Invalid persisted
 * image data fails closed instead of silently degrading a visual question to
 * text-only context.
 */
export function imageNodeToPromptPart(node: CanvasImageNodeLike): CanvasPromptPart | null {
  if (node.type !== 'image') return null
  if (!node.data || typeof node.data !== 'object') {
    throw new Error(`Canvas image ${node.id} has no image payload`)
  }

  const data = node.data as ImageNodeDataLike
  if (typeof data.src !== 'string') {
    throw new Error(`Canvas image ${node.id} has no data URI`)
  }

  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(data.src)
  if (!match) {
    throw new Error(`Canvas image ${node.id} has an unsupported or malformed data URI`)
  }

  const mediaType = match[1]
  const bytes = match[2]
  if ((mediaType !== 'image/png' && mediaType !== 'image/jpeg') || !bytes) {
    throw new Error(`Canvas image ${node.id} has an unsupported image media type`)
  }

  const name = typeof data.alt === 'string' && data.alt.trim() !== '' ? data.alt.trim() : undefined
  return {
    type: 'image',
    mediaType,
    data: bytes,
    ...(name === undefined ? {} : { name }),
  }
}
