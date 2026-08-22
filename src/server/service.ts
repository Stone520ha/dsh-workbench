import { randomUUID } from 'node:crypto'
import { buildFileDiff, applyAcceptedHunks } from '../core/diff.js'
import type { ArtifactSelection, ChangeSet, FileDiff, FilePatch, HunkDecision, HunkReviewState } from '../core/types.js'
import { CheckpointStore } from './checkpoint.js'
import { Workspace } from './workspace.js'

export interface WorkbenchServiceOptions {
  stateDir: string
  reviewRequired?: boolean
}

export class WorkbenchService {
  readonly workspace: Workspace
  private readonly checkpoints: CheckpointStore
  private readonly changes = new Map<string, ChangeSet>()
  private readonly reviewRequired: boolean

  constructor(root: string, options: WorkbenchServiceOptions) {
    this.workspace = new Workspace(root)
    this.checkpoints = new CheckpointStore(options.stateDir)
    this.reviewRequired = options.reviewRequired ?? true
  }

  list(path = '') { return this.workspace.list(path) }
  open(path: string) { return this.workspace.open(path) }

  propose(reason: string, patches: FilePatch[], selection?: ArtifactSelection): ChangeSet {
    if (!reason.trim()) throw codedError('INVALID_CHANGESET', 'ChangeSet reason must be non-empty')
    if (patches.length === 0) throw codedError('INVALID_CHANGESET', 'ChangeSet must contain at least one patch')
    const change: ChangeSet = {
      id: randomUUID(),
      reason: reason.trim(),
      patches: structuredClone(patches),
      selection: selection === undefined ? undefined : structuredClone(selection),
      status: 'proposed',
      createdAt: Date.now(),
    }
    this.changes.set(change.id, change)
    return change
  }

  async prepareReview(id: string): Promise<ChangeSet> {
    const change = this.requireChange(id)
    if (change.diffs !== undefined) return change
    const diffs: FileDiff[] = []
    const reviews: HunkReviewState[] = []
    for (const patch of change.patches) {
      if (patch.kind === 'move') throw codedError('PATCH_UNSUPPORTED', 'Move patch review is not implemented in this slice')
      let oldText: string | null = null
      let newText: string | null = null
      if (patch.kind === 'add') {
        if (await this.workspace.exists(patch.path)) throw codedError('VERSION_CONFLICT', `Cannot add existing file: ${patch.path}`)
        newText = patch.content
      } else {
        const opened = await this.workspace.open(patch.path)
        if (opened.content === undefined) throw codedError('ARTIFACT_NOT_TEXT', `Diff review requires text: ${patch.path}`)
        oldText = opened.content
        if (opened.artifact.version !== patch.baseVersion) {
          change.status = 'conflict'
          throw codedError('VERSION_CONFLICT', `Version conflict for ${patch.path}: expected ${patch.baseVersion}, current ${opened.artifact.version}`)
        }
        if (patch.kind === 'update') newText = patch.content
      }
      const diff = buildFileDiff(patch.path, oldText, newText)
      diffs.push(diff)
      reviews.push({ path: patch.path, decisions: Object.fromEntries(diff.hunks.map(h => [h.id, 'pending' as HunkDecision])) })
    }
    change.diffs = diffs
    change.reviews = reviews
    return change
  }

  async reviewHunk(id: string, path: string, hunkId: string, decision: Exclude<HunkDecision, 'pending'>): Promise<ChangeSet> {
    const change = await this.prepareReview(id)
    if (change.status !== 'proposed') throw codedError('CHANGESET_NOT_PROPOSED', `Cannot review ChangeSet in status ${change.status}`)
    const review = change.reviews?.find(row => row.path === path)
    if (review === undefined || !(hunkId in review.decisions)) throw codedError('HUNK_NOT_FOUND', `Unknown hunk ${hunkId} for ${path}`)
    review.decisions[hunkId] = decision
    return change
  }

  getChangeSet(id: string): ChangeSet {
    return structuredClone(this.requireChange(id))
  }

  listChangeSets(): ChangeSet[] {
    return [...this.changes.values()].map(change => structuredClone(change))
  }

  reject(id: string): ChangeSet {
    const change = this.requireChange(id)
    if (change.status !== 'proposed') throw codedError('CHANGESET_NOT_PROPOSED', `Cannot reject ChangeSet in status ${change.status}`)
    change.status = 'rejected'
    return structuredClone(change)
  }

  async apply(id: string, acceptAllPending = false): Promise<ChangeSet> {
    const change = await this.prepareReview(id)
    if (change.status !== 'proposed') throw codedError('CHANGESET_NOT_PROPOSED', `Cannot apply ChangeSet in status ${change.status}`)
    if (this.reviewRequired && !acceptAllPending) {
      const pending = change.reviews?.flatMap(row => Object.values(row.decisions)).some(decision => decision === 'pending')
      if (pending) throw codedError('REVIEW_INCOMPLETE', 'Every hunk must be accepted or rejected before apply')
    }
    if (acceptAllPending) {
      for (const review of change.reviews ?? []) {
        for (const id of Object.keys(review.decisions)) if (review.decisions[id] === 'pending') review.decisions[id] = 'accepted'
      }
    }

    const plan = await this.materializeAcceptedPlan(change)
    if (plan.length === 0) {
      change.status = 'rejected'
      change.appliedPaths = []
      return structuredClone(change)
    }

    const checkpointId = await this.checkpoints.create(this.workspace, plan.map(item => item.path))
    change.checkpointId = checkpointId
    const modified = new Set<string>()
    try {
      for (const item of plan) {
        await this.assertPatchStillCurrent(item.patch)
        if (item.kind === 'delete') await this.workspace.remove(item.path)
        else await this.workspace.atomicWrite(item.path, item.content)
        modified.add(item.path)
      }
      change.status = 'applied'
      change.appliedPaths = [...modified]
      return structuredClone(change)
    } catch (error) {
      change.status = isVersionConflict(error) ? 'conflict' : change.status
      // Roll back only paths this transaction actually changed. A concurrent
      // edit on an untouched later file must survive our failure.
      if (modified.size > 0) await this.checkpoints.restore(this.workspace, checkpointId, modified)
      throw error
    }
  }

  async restore(checkpointId: string): Promise<void> {
    await this.checkpoints.restore(this.workspace, checkpointId)
  }

  private async materializeAcceptedPlan(change: ChangeSet): Promise<Array<{ patch: FilePatch; path: string; kind: 'write' | 'delete'; content: string }>> {
    const plan: Array<{ patch: FilePatch; path: string; kind: 'write' | 'delete'; content: string }> = []
    for (const patch of change.patches) {
      if (patch.kind === 'move') continue
      const diff = change.diffs?.find(row => row.path === patch.path)
      const review = change.reviews?.find(row => row.path === patch.path)
      if (diff === undefined || review === undefined) throw new Error(`Missing review state for ${patch.path}`)
      const accepted = new Set(Object.entries(review.decisions).filter(([, value]) => value === 'accepted').map(([id]) => id))
      if (accepted.size === 0) continue

      if (patch.kind === 'add') {
        plan.push({ patch, path: patch.path, kind: 'write', content: patch.content })
        continue
      }
      if (patch.kind === 'delete') {
        plan.push({ patch, path: patch.path, kind: 'delete', content: '' })
        continue
      }
      const opened = await this.workspace.open(patch.path)
      if (opened.content === undefined) throw codedError('ARTIFACT_NOT_TEXT', `Cannot apply non-text diff: ${patch.path}`)
      if (opened.artifact.version !== patch.baseVersion) {
        change.status = 'conflict'
        throw codedError('VERSION_CONFLICT', `Version conflict for ${patch.path}: expected ${patch.baseVersion}, current ${opened.artifact.version}`)
      }
      const content = applyAcceptedHunks(opened.content, diff, accepted)
      if (content !== opened.content) plan.push({ patch, path: patch.path, kind: 'write', content })
    }
    return plan
  }

  private async assertPatchStillCurrent(patch: FilePatch): Promise<void> {
    if (patch.kind === 'add') {
      if (await this.workspace.exists(patch.path)) throw codedError('VERSION_CONFLICT', `Version conflict for ${patch.path}: file now exists`)
      return
    }
    const version = await this.workspace.currentVersion(patch.path)
    if (version !== patch.baseVersion) throw codedError('VERSION_CONFLICT', `Version conflict for ${patch.path}: expected ${patch.baseVersion}, current ${version}`)
  }

  private requireChange(id: string): ChangeSet {
    const change = this.changes.get(id)
    if (change === undefined) throw codedError('CHANGESET_NOT_FOUND', `Unknown ChangeSet: ${id}`)
    return change
  }
}

function isVersionConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'VERSION_CONFLICT'
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
