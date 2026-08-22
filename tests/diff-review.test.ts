import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildFileDiff, applyAcceptedHunks } from '../src/core/diff.js'
import { WorkbenchService } from '../src/server/service.js'

const OLD = [
  'export function price(base: number) {',
  '  const tax = 0.10',
  '  const shipping = 20',
  '  return base * (1 + tax) + shipping',
  '}',
  '',
  '// untouched spacer 1',
  '// untouched spacer 2',
  '// untouched spacer 3',
  '// untouched spacer 4',
  '// untouched spacer 5',
  '// untouched spacer 6',
  '// untouched spacer 7',
  '',
  'export function label() {',
  '  return "legacy"',
  '}',
  '',
].join('\n')

const NEW = [
  'export function price(base: number) {',
  '  const tax = 0.13',
  '  const shipping = 20',
  '  return base * (1 + tax) + shipping',
  '}',
  '',
  '// untouched spacer 1',
  '// untouched spacer 2',
  '// untouched spacer 3',
  '// untouched spacer 4',
  '// untouched spacer 5',
  '// untouched spacer 6',
  '// untouched spacer 7',
  '',
  'export function label() {',
  '  return "modern"',
  '}',
  '',
].join('\n')

test('diff engine creates independent hunks and can apply only one', () => {
  const diff = buildFileDiff('pricing.ts', OLD, NEW, 1)
  assert.equal(diff.hunks.length, 2)
  const firstOnly = applyAcceptedHunks(OLD, diff, new Set([diff.hunks[0]!.id]))
  assert.match(firstOnly, /tax = 0\.13/)
  assert.match(firstOnly, /return "legacy"/)
  const secondOnly = applyAcceptedHunks(OLD, diff, new Set([diff.hunks[1]!.id]))
  assert.match(secondOnly, /tax = 0\.10/)
  assert.match(secondOnly, /return "modern"/)
})

test('hunk-level review applies accepted hunks and leaves rejected hunks untouched', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'workbench-hunk-'))
  const stateDir = await mkdtemp(path.join(tmpdir(), 'workbench-hunk-state-'))
  await writeFile(path.join(root, 'pricing.ts'), OLD)
  const service = new WorkbenchService(root, { stateDir, reviewRequired: true })
  const opened = await service.open('pricing.ts')
  const change = service.propose('two independent edits', [{
    kind: 'update', path: 'pricing.ts', baseVersion: opened.artifact.version, content: NEW,
  }])
  const review = await service.prepareReview(change.id)
  const diff = review.diffs![0]!
  assert.equal(diff.hunks.length, 2)
  await service.reviewHunk(change.id, 'pricing.ts', diff.hunks[0]!.id, 'accepted')
  await service.reviewHunk(change.id, 'pricing.ts', diff.hunks[1]!.id, 'rejected')
  const applied = await service.apply(change.id)
  assert.equal(applied.status, 'applied')
  const final = await readFile(path.join(root, 'pricing.ts'), 'utf8')
  assert.match(final, /tax = 0\.13/)
  assert.match(final, /return "legacy"/)
  assert.equal(typeof applied.checkpointId, 'string')
  await service.restore(applied.checkpointId!)
  assert.equal(await readFile(path.join(root, 'pricing.ts'), 'utf8'), OLD)
})

test('apply fails closed while any hunk is still pending', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'workbench-pending-'))
  const stateDir = await mkdtemp(path.join(tmpdir(), 'workbench-pending-state-'))
  await writeFile(path.join(root, 'pricing.ts'), OLD)
  const service = new WorkbenchService(root, { stateDir, reviewRequired: true })
  const opened = await service.open('pricing.ts')
  const change = service.propose('review required', [{ kind: 'update', path: 'pricing.ts', baseVersion: opened.artifact.version, content: NEW }])
  const review = await service.prepareReview(change.id)
  await service.reviewHunk(change.id, 'pricing.ts', review.diffs![0]!.hunks[0]!.id, 'accepted')
  await assert.rejects(() => service.apply(change.id), /Every hunk must be accepted or rejected/)
  assert.equal(await readFile(path.join(root, 'pricing.ts'), 'utf8'), OLD)
})
