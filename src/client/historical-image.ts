export type HistoricalImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface HistoricalImageRef {
  readonly attachmentId: string
  readonly mediaType: HistoricalImageMediaType
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

export interface DshHistoricalImageNodeLike {
  readonly kind?: string
  readonly data?: unknown
}

export interface LoadedHistoricalImage {
  readonly attachment: HistoricalImageRef
  readonly data: Uint8Array
}

const CANVAS_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const CANVAS_IMAGE_TARGET_BYTES = Math.floor(CANVAS_IMAGE_MAX_BYTES * 0.94)

function imageMediaType(value: unknown): HistoricalImageMediaType | undefined {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
    ? value
    : undefined
}

function asHistoricalImageRef(value: unknown): HistoricalImageRef | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const mediaType = imageMediaType(raw.mediaType)
  if (
    typeof raw.attachmentId !== 'string' || raw.attachmentId === ''
    || mediaType === undefined
    || typeof raw.bytes !== 'number' || !Number.isFinite(raw.bytes) || raw.bytes < 0
    || typeof raw.width !== 'number' || !Number.isFinite(raw.width) || raw.width <= 0
    || typeof raw.height !== 'number' || !Number.isFinite(raw.height) || raw.height <= 0
  ) return undefined
  return {
    attachmentId: raw.attachmentId,
    mediaType,
    bytes: raw.bytes,
    width: raw.width,
    height: raw.height,
    ...(typeof raw.name === 'string' && raw.name.trim() !== '' ? { name: raw.name.trim() } : {}),
  }
}

/**
 * Extract durable DSH image references from one assembled Chat node.
 * User/steering/context nodes carry core ContentBlocks; assistant-step nodes
 * carry UI-classified AssistantBlocks. Attachment identity, not message order,
 * is the stable dedupe key.
 */
export function historicalImageRefs(node: DshHistoricalImageNodeLike): HistoricalImageRef[] {
  if (!node.data || typeof node.data !== 'object') return []
  const data = node.data as Record<string, unknown>
  const candidates: unknown[] = []

  if ((node.kind === 'user' || node.kind === 'steering' || node.kind === 'context') && Array.isArray(data.content)) {
    for (const block of data.content) {
      if (!block || typeof block !== 'object') continue
      const raw = block as Record<string, unknown>
      if (raw.type === 'image') candidates.push(raw.attachment)
    }
  }

  if (node.kind === 'assistant-step' && Array.isArray(data.blocks)) {
    for (const block of data.blocks) {
      if (!block || typeof block !== 'object') continue
      const raw = block as Record<string, unknown>
      if (raw.kind === 'image') candidates.push(raw.attachment)
    }
  }

  const refs: HistoricalImageRef[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const ref = asHistoricalImageRef(candidate)
    if (!ref || seen.has(ref.attachmentId)) continue
    seen.add(ref.attachmentId)
    refs.push(ref)
  }
  return refs
}

/** Attachment id retained on a canvas image node after DSH history projection. */
export function historicalAttachmentIdOfCanvasNode(node: { type?: string; data?: unknown } | undefined): string | undefined {
  if (node?.type !== 'image' || !node.data || typeof node.data !== 'object') return undefined
  const id = (node.data as { dshAttachmentId?: unknown }).dshAttachmentId
  return typeof id === 'string' && id !== '' ? id : undefined
}

function copyBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

/**
 * Convert a verified DSH attachment into canvas-harness' PNG/JPEG <=2 MiB
 * intake contract. WebP/GIF become a PNG still; oversized PNG/JPEG are
 * progressively re-encoded/downscaled before store.addImage sees them.
 */
export async function canvasReadyHistoricalImageBlob(loaded: LoadedHistoricalImage): Promise<Blob> {
  const source = new Blob([copyBytes(loaded.data)], { type: loaded.attachment.mediaType })
  const direct = loaded.attachment.mediaType === 'image/png' || loaded.attachment.mediaType === 'image/jpeg'
  if (direct && source.size <= CANVAS_IMAGE_MAX_BYTES) return source

  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new Error(`Canvas cannot decode historical ${loaded.attachment.mediaType} image in this browser`)
  }

  const bitmap = await createImageBitmap(source)
  try {
    const maxSide = Math.max(bitmap.width, bitmap.height)
    let scale = Math.min(1, 2048 / Math.max(1, maxSide))
    const outputType = loaded.attachment.mediaType === 'image/jpeg' ? 'image/jpeg' : 'image/png'

    for (let attempt = 0; attempt < 8; attempt++) {
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas could not acquire a 2D context for historical image conversion')
      context.drawImage(bitmap, 0, 0, width, height)
      const converted = await canvas.convertToBlob({
        type: outputType,
        ...(outputType === 'image/jpeg' ? { quality: Math.max(0.58, 0.9 - attempt * 0.05) } : {}),
      })
      if (converted.size <= CANVAS_IMAGE_TARGET_BYTES) return converted
      scale *= 0.76
    }
  } finally {
    bitmap.close?.()
  }

  throw new Error(`Historical image ${loaded.attachment.attachmentId} could not fit the Canvas image size limit`)
}
