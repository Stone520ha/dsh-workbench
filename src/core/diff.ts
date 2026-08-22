import { createHash } from 'node:crypto'
import type { DiffHunk, DiffLine, FileDiff } from './types.js'

type Op = {
  type: 'equal' | 'add' | 'delete'
  text: string
  oldBefore: number
  oldAfter: number
  newBefore: number
  newAfter: number
}

const DEFAULT_CONTEXT = 3
const MAX_LCS_CELLS = 4_000_000

/**
 * Produce a deterministic line-oriented review diff. For very large inputs the
 * implementation deliberately degrades to one whole-file hunk rather than
 * allocating an unbounded LCS matrix.
 */
export function buildFileDiff(path: string, oldText: string | null, newText: string | null, context = DEFAULT_CONTEXT): FileDiff {
  if (oldText === newText) return { path, oldText, newText, hunks: [] }
  if (oldText === null || newText === null) return wholeFileDiff(path, oldText, newText)

  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  if ((oldLines.length + 1) * (newLines.length + 1) > MAX_LCS_CELLS) {
    return wholeFileDiff(path, oldText, newText)
  }

  const ops = lcsOps(oldLines, newLines)
  const changeIndexes = ops.flatMap((op, index) => op.type === 'equal' ? [] : [index])
  if (changeIndexes.length === 0) return { path, oldText, newText, hunks: [] }

  const groups: Array<{ first: number; last: number }> = []
  let first = changeIndexes[0]!
  let last = first
  for (let i = 1; i < changeIndexes.length; i++) {
    const current = changeIndexes[i]!
    const equalGap = current - last - 1
    if (equalGap <= context * 2) last = current
    else {
      groups.push({ first, last })
      first = current
      last = current
    }
  }
  groups.push({ first, last })

  const hunks = groups.map((group, index) => buildHunk(path, ops, group.first, group.last, context, index))
  return { path, oldText, newText, hunks }
}

export function applyAcceptedHunks(baseText: string, diff: FileDiff, acceptedHunkIds: ReadonlySet<string>): string {
  if (diff.oldText === null) {
    const accepted = diff.hunks.some(h => acceptedHunkIds.has(h.id))
    return accepted ? (diff.newText ?? '') : baseText
  }
  if (diff.oldText !== baseText) throw codedError('VERSION_CONFLICT', `Cannot apply diff for ${diff.path}: base content changed`)
  const lines = splitLines(baseText)
  const hunks = diff.hunks.filter(h => acceptedHunkIds.has(h.id)).sort((a, b) => b.baseStart - a.baseStart)
  for (const hunk of hunks) {
    lines.splice(hunk.baseStart, hunk.baseEnd - hunk.baseStart, ...hunk.replacementLines)
  }
  return joinLines(lines)
}

function wholeFileDiff(path: string, oldText: string | null, newText: string | null): FileDiff {
  const oldLines = oldText === null ? [] : splitLines(oldText)
  const newLines = newText === null ? [] : splitLines(newText)
  const lines: DiffLine[] = [
    ...oldLines.map((text, index) => ({ type: 'delete' as const, text, oldLine: index + 1 })),
    ...newLines.map((text, index) => ({ type: 'add' as const, text, newLine: index + 1 })),
  ]
  const hunk: DiffHunk = {
    id: hunkId(path, 0, oldLines.length, 0, newLines.length),
    oldStart: oldLines.length === 0 ? 0 : 1,
    oldLines: oldLines.length,
    newStart: newLines.length === 0 ? 0 : 1,
    newLines: newLines.length,
    baseStart: 0,
    baseEnd: oldLines.length,
    replacementLines: newLines,
    lines,
  }
  return { path, oldText, newText, hunks: [hunk] }
}

function buildHunk(path: string, ops: Op[], firstChange: number, lastChange: number, context: number, ordinal: number): DiffHunk {
  let displayStart = firstChange
  let before = 0
  while (displayStart > 0 && before < context && ops[displayStart - 1]?.type === 'equal') {
    displayStart--
    before++
  }
  let displayEnd = lastChange
  let after = 0
  while (displayEnd + 1 < ops.length && after < context && ops[displayEnd + 1]?.type === 'equal') {
    displayEnd++
    after++
  }

  const first = ops[firstChange]!
  const last = ops[lastChange]!
  const baseStart = first.oldBefore
  const baseEnd = last.oldAfter
  const newStart0 = first.newBefore
  const newEnd0 = last.newAfter
  const replacementLines: string[] = []
  for (let i = firstChange; i <= lastChange; i++) {
    const op = ops[i]!
    if (op.type !== 'delete') replacementLines.push(op.text)
  }

  const displayOps = ops.slice(displayStart, displayEnd + 1)
  const lines: DiffLine[] = displayOps.map(op => {
    if (op.type === 'equal') return { type: 'context', text: op.text, oldLine: op.oldBefore + 1, newLine: op.newBefore + 1 }
    if (op.type === 'delete') return { type: 'delete', text: op.text, oldLine: op.oldBefore + 1 }
    return { type: 'add', text: op.text, newLine: op.newBefore + 1 }
  })

  const displayFirst = displayOps[0]!
  const displayLast = displayOps[displayOps.length - 1]!
  return {
    id: `${hunkId(path, baseStart, baseEnd, newStart0, newEnd0)}:${ordinal}`,
    oldStart: displayFirst.oldBefore + 1,
    oldLines: displayLast.oldAfter - displayFirst.oldBefore,
    newStart: displayFirst.newBefore + 1,
    newLines: displayLast.newAfter - displayFirst.newBefore,
    baseStart,
    baseEnd,
    replacementLines,
    lines,
  }
}

function lcsOps(oldLines: string[], newLines: string[]): Op[] {
  const n = oldLines.length
  const m = newLines.length
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = oldLines[i] === newLines[j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    const oldBefore = i
    const newBefore = j
    if (i < n && j < m && oldLines[i] === newLines[j]) {
      i++; j++
      ops.push({ type: 'equal', text: oldLines[i - 1]!, oldBefore, oldAfter: i, newBefore, newAfter: j })
      continue
    }
    if (j < m && (i === n || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) {
      j++
      ops.push({ type: 'add', text: newLines[j - 1]!, oldBefore, oldAfter: i, newBefore, newAfter: j })
      continue
    }
    i++
    ops.push({ type: 'delete', text: oldLines[i - 1]!, oldBefore, oldAfter: i, newBefore, newAfter: j })
  }
  return ops
}

function hunkId(path: string, oldStart: number, oldEnd: number, newStart: number, newEnd: number): string {
  return createHash('sha256').update(`${path}\0${oldStart}:${oldEnd}\0${newStart}:${newEnd}`).digest('hex').slice(0, 16)
}

function splitLines(text: string): string[] {
  return text.split('\n')
}

function joinLines(lines: string[]): string {
  return lines.join('\n')
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
