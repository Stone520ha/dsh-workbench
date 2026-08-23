export interface DshWebChatNodeLike {
  readonly kind?: string
  readonly data?: unknown
}

export interface CanvasWebReference {
  /** Stable page identity: HTTP(S), default port normalized, fragment removed. */
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
  readonly source: 'search' | 'fetch'
  readonly statusCode?: number
  readonly truncated?: boolean
}

interface WebSourceLike {
  readonly url?: unknown
  readonly title?: unknown
  readonly snippet?: unknown
  readonly publishedAt?: unknown
}

interface WebResultViewLike {
  readonly card?: unknown
  readonly kind?: unknown
  readonly title?: unknown
  readonly sources?: unknown
  readonly url?: unknown
  readonly statusCode?: unknown
  readonly truncated?: unknown
}

/**
 * Canonicalize one navigable web URL for Canvas identity.
 * Query remains because it may select materially different content; fragments
 * are navigation-only and are removed so two citations of the same page dedupe.
 */
export function canonicalWebUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}

export function webHostLabel(value: string): string {
  try {
    return new URL(value).hostname || value
  } catch {
    return value
  }
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function settledWebResult(node: DshWebChatNodeLike): WebResultViewLike | undefined {
  if (node.kind !== 'tool-call' || !node.data || typeof node.data !== 'object') return undefined
  const root = (node.data as { root?: unknown }).root
  if (!root || typeof root !== 'object') return undefined
  const result = root as { kind?: unknown; isError?: unknown; resultView?: unknown }
  if (result.kind !== 'tool-result' || result.isError === true) return undefined
  if (!result.resultView || typeof result.resultView !== 'object') return undefined
  const view = result.resultView as WebResultViewLike
  return view.card === 'web' ? view : undefined
}

/**
 * Project DSH's persisted ToolResultView `card: web` into first-class Canvas
 * web references. This intentionally does not scrape assistant prose: web_search
 * and web_fetch already publish the lossless structured result vocabulary.
 */
export function webReferences(node: DshWebChatNodeLike): CanvasWebReference[] {
  const view = settledWebResult(node)
  if (!view) return []

  if (view.kind === 'fetch') {
    if (typeof view.url !== 'string') return []
    const url = canonicalWebUrl(view.url)
    if (!url) return []
    const statusCode = typeof view.statusCode === 'number' && Number.isFinite(view.statusCode)
      ? Math.trunc(view.statusCode)
      : undefined
    return [{
      url,
      source: 'fetch',
      ...(cleanText(view.title) === undefined ? {} : { title: cleanText(view.title) }),
      ...(statusCode === undefined ? {} : { statusCode }),
      ...(typeof view.truncated === 'boolean' ? { truncated: view.truncated } : {}),
    }]
  }

  if (view.kind !== 'search' || !Array.isArray(view.sources)) return []
  const refs: CanvasWebReference[] = []
  const seen = new Set<string>()
  for (const raw of view.sources) {
    if (!raw || typeof raw !== 'object') continue
    const source = raw as WebSourceLike
    if (typeof source.url !== 'string') continue
    const url = canonicalWebUrl(source.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = cleanText(source.title)
    const snippet = cleanText(source.snippet)
    const publishedAt = cleanText(source.publishedAt)
    refs.push({
      url,
      source: 'search',
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
      ...(typeof view.truncated === 'boolean' ? { truncated: view.truncated } : {}),
    })
  }
  return refs
}

export function webUrlOfCanvasNode(node: { data?: unknown } | undefined): string | undefined {
  if (!node?.data || typeof node.data !== 'object') return undefined
  const data = node.data as { localKind?: unknown; url?: unknown }
  return data.localKind === 'web' && typeof data.url === 'string' ? canonicalWebUrl(data.url) : undefined
}
