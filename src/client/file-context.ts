export interface DshChatNodeLike {
  readonly kind?: string
  readonly data?: unknown
}

interface ToolLocationLike {
  readonly path?: unknown
}

interface ToolViewLike {
  readonly card?: unknown
  readonly kind?: unknown
  readonly locations?: unknown
}

interface ToolRootLike {
  readonly kind?: unknown
  readonly isError?: unknown
  readonly callView?: unknown
}

/**
 * Mirror DSH ui-deliverables' public presentation policy over the already
 * assembled chat Tool node: successful diff cards and generic edit cards
 * produce file paths; reads, deletes, terminals, running calls and failures do not.
 */
export function producedFilePaths(node: DshChatNodeLike): string[] {
  if (node.kind !== 'tool-call' || !node.data || typeof node.data !== 'object') return []
  const root = (node.data as { root?: unknown }).root
  if (!root || typeof root !== 'object') return []
  const settled = root as ToolRootLike
  if (settled.kind !== 'tool-result' || settled.isError === true) return []
  if (!settled.callView || typeof settled.callView !== 'object') return []

  const view = settled.callView as ToolViewLike
  const produces = view.card === 'diff' || (view.card === 'generic' && view.kind === 'edit')
  if (!produces || !Array.isArray(view.locations)) return []

  const paths: string[] = []
  const seen = new Set<string>()
  for (const raw of view.locations) {
    if (!raw || typeof raw !== 'object') continue
    const path = (raw as ToolLocationLike).path
    if (typeof path !== 'string' || path.trim() === '' || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths
}

export function fileBasename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Browser-safe equivalent of DSH resolveWorkspacePath for Host openPath. */
export function resolveHostFilePath(cwd: string | undefined, path: string): string {
  if (path.startsWith('/') || /^[A-Za-z]:[/\\]/u.test(path) || path.startsWith('\\\\')) return path
  if (!cwd) return path
  const base = cwd.replace(/[/\\]+$/u, '')
  const rel = path.replace(/^[/\\]+/u, '')
  return `${base}/${rel}`
}
