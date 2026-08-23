export interface DshCodeChatNodeLike {
  readonly kind?: string
  readonly data?: unknown
}

export interface CanvasCodeLine {
  readonly number: number
  readonly text: string
}

export interface CanvasCodeReference {
  readonly path: string
  readonly offset: number
  readonly lines: readonly CanvasCodeLine[]
  readonly totalLines: number
  readonly lang?: string
  readonly title?: string
}

interface ReadResultViewLike {
  readonly card?: unknown
  readonly title?: unknown
  readonly path?: unknown
  readonly offset?: unknown
  readonly lines?: unknown
  readonly totalLines?: unknown
  readonly lang?: unknown
}

function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Project DSH's persisted `ReadResultView` into a first-class Code reference.
 * The structured view is authoritative; raw tool text is deliberately ignored.
 */
export function codeReferences(node: DshCodeChatNodeLike): CanvasCodeReference[] {
  if (node.kind !== 'tool-call' || !node.data || typeof node.data !== 'object') return []
  const root = (node.data as { root?: unknown }).root
  if (!root || typeof root !== 'object') return []
  const result = root as { kind?: unknown; isError?: unknown; resultView?: unknown }
  if (result.kind !== 'tool-result' || result.isError === true) return []
  if (!result.resultView || typeof result.resultView !== 'object') return []
  const view = result.resultView as ReadResultViewLike
  if (view.card !== 'read') return []

  const path = nonBlank(view.path)
  if (!path || !Number.isInteger(view.offset) || (view.offset as number) < 1) return []
  if (!Number.isInteger(view.totalLines) || (view.totalLines as number) < 0 || !Array.isArray(view.lines)) return []

  const lines: CanvasCodeLine[] = []
  for (const raw of view.lines) {
    if (!raw || typeof raw !== 'object') return []
    const line = raw as { number?: unknown; text?: unknown }
    if (!Number.isInteger(line.number) || (line.number as number) < 1 || typeof line.text !== 'string') return []
    lines.push({ number: line.number as number, text: line.text })
  }

  const lang = nonBlank(view.lang)
  const title = nonBlank(view.title)
  return [{
    path,
    offset: view.offset as number,
    lines,
    totalLines: view.totalLines as number,
    ...(lang === undefined ? {} : { lang }),
    ...(title === undefined ? {} : { title }),
  }]
}

export function codeIdentity(ref: Pick<CanvasCodeReference, 'path' | 'offset'>): string {
  return `${ref.path}#L${ref.offset}`
}

export function codePathOfCanvasNode(node: { data?: unknown } | undefined): string | undefined {
  if (!node?.data || typeof node.data !== 'object') return undefined
  const data = node.data as { localKind?: unknown; path?: unknown }
  return data.localKind === 'code' && typeof data.path === 'string' && data.path !== '' ? data.path : undefined
}

export function codeRangeLabel(ref: CanvasCodeReference): string {
  if (ref.lines.length === 0) return `from line ${ref.offset}`
  const first = ref.lines[0]?.number ?? ref.offset
  const last = ref.lines[ref.lines.length - 1]?.number ?? first
  return first === last ? `line ${first}` : `lines ${first}-${last}`
}
