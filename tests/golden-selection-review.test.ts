import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WorkbenchScopeRegistry } from '../src/server/scope-registry.js'
import { dispatchWorkbenchCall, type WorkbenchAgentRegistryLike } from '../src/server/http-transport.js'
import { validateSelection } from '../src/core/selection.js'
import type { Artifact, TextRangeSelection, FilePatch } from '../src/core/types.js'

const ORIGINAL = `function calculatePrice(price: number, discount: number) {\n  return price - discount\n}\n`
const EXPECTED = `function calculatePrice(price: number, discount: number) {\n  return price * (1 - discount / 100)\n}\n`

interface GoldenAgentInput {
  artifact: Artifact
  selection: TextRangeSelection
  selectedText: string
  content: string
  instruction: string
}

/**
 * Deterministic stand-in for the model layer. This deliberately does not touch
 * the filesystem: it can only return proposed patches, which lets the Golden
 * test prove the Workbench review boundary independently of model variance.
 */
function percentageDiscountAgent(input: GoldenAgentInput): FilePatch[] {
  assert.match(input.instruction, /百分比/)
  assert.equal(input.selectedText, ORIGINAL.trimEnd())
  assert.equal(input.selection.version, input.artifact.version)
  assert.equal(input.artifact.uri, 'price.ts')
  return [{
    kind: 'update',
    path: input.artifact.uri,
    baseVersion: input.artifact.version,
    content: EXPECTED,
  }]
}

function selectionForWholeFunction(artifact: Artifact): TextRangeSelection {
  return {
    kind: 'text-range',
    artifactId: artifact.id,
    version: artifact.version,
    start: { line: 1, column: 1 },
    end: { line: 3, column: 2 },
  }
}

function agentRegistry(sessions: Record<string, string>): WorkbenchAgentRegistryLike {
  return {
    get(sessionId: string) {
      const cwd = sessions[sessionId]
      return cwd === undefined ? undefined : { session: { header: { cwd } } }
    },
  }
}

test('Golden: selection -> proposal -> review -> apply -> restore -> conflict -> session isolation', async () => {
  const rootA = await mkdtemp(path.join(tmpdir(), 'workbench-golden-a-'))
  const rootB = await mkdtemp(path.join(tmpdir(), 'workbench-golden-b-'))
  const stateDir = await mkdtemp(path.join(tmpdir(), 'workbench-golden-state-'))
  await writeFile(path.join(rootA, 'price.ts'), ORIGINAL)
  await writeFile(path.join(rootB, 'other.ts'), 'export const other = true\n')

  const agents = agentRegistry({ 'session-a': rootA, 'session-b': rootB })
  const scopes = new WorkbenchScopeRegistry({ stateDir, reviewRequired: true })

  const opened = await dispatchWorkbenchCall(agents, scopes, {
    sessionId: 'session-a',
    method: 'open',
    args: ['price.ts'],
  }) as { artifact: Artifact; content: string }
  assert.equal(opened.content, ORIGINAL)
  const selection = selectionForWholeFunction(opened.artifact)
  validateSelection(selection, opened.artifact)

  const patches = percentageDiscountAgent({
    artifact: opened.artifact,
    selection,
    selectedText: ORIGINAL.trimEnd(),
    content: opened.content,
    instruction: '折扣改成百分比，例如 discount=20 表示八折',
  })

  const first = await dispatchWorkbenchCall(agents, scopes, {
    sessionId: 'session-a',
    method: 'propose',
    args: ['percentage discount', patches, selection],
  }) as { id: string; status: string; selection: TextRangeSelection }
  assert.equal(first.status, 'proposed')
  assert.deepEqual(first.selection, selection)
  assert.equal(await readFile(path.join(rootA, 'price.ts'), 'utf8'), ORIGINAL)

  const rejected = await dispatchWorkbenchCall(agents, scopes, {
    sessionId: 'session-a',
    method: 'reject',
    args: [first.id],
  }) as { status: string }
  assert.equal(rejected.status, 'rejected')
  assert.equal(await readFile(path.join(rootA, 'price.ts'), 'utf8'), ORIGINAL)

  const second = await dispatchWorkbenchCall(agents, scopes, {
    sessionId: 'session-a',
    method: 'propose',
    args: ['percentage discount', patches, selection],
  }) as { id: string }
  const applied = await dispatchWorkbenchCall(agents, scopes, {
    sessionId: 'session-a',
    method: 'apply',
    args: [second.id, true],
  }) as { status: string; checkpointId?: string }
  assert.equal(applied.status, 'applied')
  assert.equal(typeof applied.checkpointId, 'string')
  assert.equal(await readFile(path.join(rootA, 'price.ts'), 'utf8'), EXPECTED)

  await dispatchWorkbenchCall(agents, scopes, {
    sessionId: 'session-a',
    method: 'restore',
    args: [applied.checkpointId],
  })
  assert.equal(await readFile(path.join(rootA, 'price.ts'), 'utf8'), ORIGINAL)

  const reopened = await dispatchWorkbenchCall(agents, scopes, {
    sessionId: 'session-a',
    method: 'open',
    args: ['price.ts'],
  }) as { artifact: Artifact; content: string }
  const staleSelection = selectionForWholeFunction(reopened.artifact)
  const stalePatches = percentageDiscountAgent({
    artifact: reopened.artifact,
    selection: staleSelection,
    selectedText: ORIGINAL.trimEnd(),
    content: reopened.content,
    instruction: '折扣改成百分比，例如 discount=20 表示八折',
  })
  const stale = await dispatchWorkbenchCall(agents, scopes, {
    sessionId: 'session-a',
    method: 'propose',
    args: ['stale proposal', stalePatches, staleSelection],
  }) as { id: string }

  const EXTERNAL = '// external concurrent edit\n' + ORIGINAL
  await writeFile(path.join(rootA, 'price.ts'), EXTERNAL)
  await assert.rejects(
    () => dispatchWorkbenchCall(agents, scopes, {
      sessionId: 'session-a',
      method: 'apply',
      args: [stale.id, true],
    }),
    /Version conflict/,
  )
  assert.equal(await readFile(path.join(rootA, 'price.ts'), 'utf8'), EXTERNAL)
  const conflicted = await dispatchWorkbenchCall(agents, scopes, {
    sessionId: 'session-a',
    method: 'getChangeSet',
    args: [stale.id],
  }) as { status: string }
  assert.equal(conflicted.status, 'conflict')

  const listB = await dispatchWorkbenchCall(agents, scopes, {
    sessionId: 'session-b',
    method: 'list',
    args: [''],
  }) as Array<{ name: string }>
  assert.deepEqual(listB.map(item => item.name), ['other.ts'])
  await assert.rejects(
    () => dispatchWorkbenchCall(agents, scopes, {
      sessionId: 'session-b',
      method: 'open',
      args: ['price.ts'],
    }),
  )
})
