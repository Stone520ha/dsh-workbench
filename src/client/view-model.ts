import type { BrowserWorkbenchState } from './controller.js'
import type { DiffLine, HunkDecision } from '../core/types.js'

export interface HunkViewModel {
  path: string
  id: string
  header: string
  decision: HunkDecision
  comment: string
  lines: Array<DiffLine & { marker: ' ' | '+' | '-' }>
}

export interface WorkbenchViewModel {
  title: string
  url: string
  canAskAgent: boolean
  canApply: boolean
  pendingHunks: number
  selectedLabel?: string
  hunks: HunkViewModel[]
}

export function buildWorkbenchViewModel(state: Readonly<BrowserWorkbenchState>): WorkbenchViewModel {
  const hunks: HunkViewModel[] = []
  for (const diff of state.changeSet?.diffs ?? []) {
    const review = state.changeSet?.reviews?.find(row => row.path === diff.path)
    for (const hunk of diff.hunks) {
      hunks.push({
        path: diff.path,
        id: hunk.id,
        header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        decision: review?.decisions[hunk.id] ?? 'pending',
        comment: state.comments[hunk.id] ?? '',
        lines: hunk.lines.map(line => ({ ...line, marker: line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ' })),
      })
    }
  }
  const pendingHunks = hunks.filter(hunk => hunk.decision === 'pending').length
  const selected = state.selected?.element
  return {
    title: state.preview?.title || state.tabs.find(tab => tab.id === state.activeTabId)?.title || 'Browser',
    url: state.preview?.url ?? state.tabs.find(tab => tab.id === state.activeTabId)?.url ?? '',
    canAskAgent: state.selected !== undefined && state.instruction.trim().length > 0 && !state.busy,
    canApply: state.changeSet?.status === 'proposed' && pendingHunks === 0 && hunks.some(hunk => hunk.decision === 'accepted') && !state.busy,
    pendingHunks,
    selectedLabel: selected === undefined ? undefined : `${selected.tagName.toLowerCase()}${selected.id ? `#${selected.id}` : ''}${selected.className ? `.${selected.className.split(/\s+/)[0]}` : ''}`,
    hunks,
  }
}
