import type { Artifact, ArtifactSelection, TextRangeSelection } from './types.js'

export function validateSelection(selection: ArtifactSelection, artifact: Artifact): void {
  if (selection.artifactId !== artifact.id) {
    throw codedError('SELECTION_ARTIFACT_MISMATCH', `Selection belongs to ${selection.artifactId}, not ${artifact.id}`)
  }
  if (selection.version !== artifact.version) {
    throw codedError('VERSION_CONFLICT', `Selection version ${selection.version} does not match current ${artifact.version}`)
  }
  if (selection.kind === 'text-range') validateTextRange(selection)
}

function validateTextRange(selection: TextRangeSelection): void {
  const positions = [selection.start, selection.end]
  for (const position of positions) {
    if (!Number.isInteger(position.line) || position.line < 1) throw codedError('INVALID_SELECTION', 'Selection line must be a positive integer')
    if (!Number.isInteger(position.column) || position.column < 1) throw codedError('INVALID_SELECTION', 'Selection column must be a positive integer')
  }
  if (
    selection.end.line < selection.start.line
    || (selection.end.line === selection.start.line && selection.end.column < selection.start.column)
  ) {
    throw codedError('INVALID_SELECTION', 'Selection end precedes start')
  }
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
