export type ArtifactKind = 'code' | 'text' | 'web' | 'image' | 'pdf' | 'document' | 'spreadsheet' | 'slides' | 'binary'

export interface Artifact {
  id: string
  uri: string
  kind: ArtifactKind
  version: string
  title?: string
  capabilities?: {
    read: boolean
    edit: boolean
    select: boolean
    diff: boolean
    preview: boolean
  }
}

export interface TextPosition {
  line: number
  column: number
}

export interface TextRangeSelection {
  kind: 'text-range'
  artifactId: string
  version: string
  start: TextPosition
  end: TextPosition
}

export interface DomSelection {
  kind: 'dom-node'
  artifactId: string
  version: string
  selector: string
  url: string
}

export interface ImageRegionSelection {
  kind: 'image-region'
  artifactId: string
  version: string
  bbox: { x: number; y: number; width: number; height: number }
}

export interface SpreadsheetRangeSelection {
  kind: 'spreadsheet-range'
  artifactId: string
  version: string
  sheet: string
  range: string
}

export interface SlideObjectSelection {
  kind: 'slide-object'
  artifactId: string
  version: string
  slide: number
  objectId: string
}

export interface PdfRegionSelection {
  kind: 'pdf-region'
  artifactId: string
  version: string
  page: number
  bbox: { x: number; y: number; width: number; height: number }
}

export type ArtifactSelection =
  | TextRangeSelection
  | DomSelection
  | ImageRegionSelection
  | SpreadsheetRangeSelection
  | SlideObjectSelection
  | PdfRegionSelection

export interface AddFilePatch {
  kind: 'add'
  path: string
  content: string
}

export interface UpdateFilePatch {
  kind: 'update'
  path: string
  baseVersion: string
  content: string
}

export interface DeleteFilePatch {
  kind: 'delete'
  path: string
  baseVersion: string
}

export interface MoveFilePatch {
  kind: 'move'
  path: string
  to: string
  baseVersion: string
}

export type FilePatch = AddFilePatch | UpdateFilePatch | DeleteFilePatch | MoveFilePatch
export type ChangeSetStatus = 'proposed' | 'applied' | 'rejected' | 'conflict'
export type HunkDecision = 'pending' | 'accepted' | 'rejected'

export interface DiffLine {
  type: 'context' | 'add' | 'delete'
  text: string
  oldLine?: number
  newLine?: number
}

export interface DiffHunk {
  id: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Exact old slice replaced when this hunk is accepted; zero-based, end-exclusive. */
  baseStart: number
  baseEnd: number
  replacementLines: string[]
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldText: string | null
  newText: string | null
  hunks: DiffHunk[]
}

export interface HunkReviewState {
  path: string
  decisions: Record<string, HunkDecision>
}

export interface ChangeSet {
  id: string
  reason: string
  patches: FilePatch[]
  selection?: ArtifactSelection
  status: ChangeSetStatus
  createdAt: number
  checkpointId?: string
  diffs?: FileDiff[]
  reviews?: HunkReviewState[]
  appliedPaths?: string[]
}
