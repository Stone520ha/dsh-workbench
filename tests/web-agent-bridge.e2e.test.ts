import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserSessionRegistry } from '../src/server/browser-registry.js'
import { WorkbenchScopeRegistry } from '../src/server/scope-registry.js'
import { WorkbenchAgentBridge, type WorkbenchAgentLike, type WorkbenchAgentRuntimeAdapter, type WorkbenchAgentTaskContext, type WorkbenchProposalInput } from '../src/server/agent-bridge.js'
import type { ChangeSet } from '../src/core/types.js'

class FakeRuntime implements WorkbenchAgentRuntimeAdapter {
  installProposalTool(agent: WorkbenchAgentLike, onProposal: (input: WorkbenchProposalInput) => Promise<ChangeSet>): () => void {
    ;(agent as FakeAgent).proposal = onProposal
    return () => { (agent as FakeAgent).proposal = undefined }
  }
  makeContextMessage(task: WorkbenchAgentTaskContext): unknown { return task }
  makeFollowupMessage(task: WorkbenchAgentTaskContext): unknown { return task.instruction }
}

class FakeAgent implements WorkbenchAgentLike {
  readonly ctx = {
    tools: {
      register: (_definition: unknown) => () => undefined,
      guard: (guard: (execution: { name: string }) => string | undefined) => { this.guard = guard; return () => { this.guard = undefined } },
    },
  }
  proposal?: (input: WorkbenchProposalInput) => Promise<ChangeSet>
  guard?: (execution: { name: string }) => string | undefined
  private task: Promise<void> = Promise.resolve()
  constructor(readonly session: { header: { cwd?: string } }) {}
  inject(message: unknown): void { this.injected = message }
  injected?: unknown
  followup(_message: unknown): void {
    this.task = (async () => {
      assert.match(this.guard?.({ name: 'write' }) ?? '', /Workbench review mode/)
      assert.equal(this.guard?.({ name: 'read' }), undefined)
      if (this.proposal === undefined) throw new Error('proposal tool missing')
      await this.proposal({
        reason: 'make selected button younger',
        patches: [{ kind: 'update', path: 'button.css', content: '#buy { border-radius: 12px; font-size: 16px; }\n' }],
      })
    })()
  }
  whenIdle(): Promise<void> { return this.task }
}

test('web DOM selection -> Agent -> review-only ChangeSet -> apply', { timeout: 30_000 }, async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'workbench-web-agent-'))
  const stateDir = await mkdtemp(path.join(tmpdir(), 'workbench-web-agent-state-'))
  await writeFile(path.join(workspace, 'button.css'), '#buy { border-radius: 4px; font-size: 18px; }\n')

  const browsers = new BrowserSessionRegistry({ stateDir, browser: { headless: true } })
  const scopes = new WorkbenchScopeRegistry({ stateDir, reviewRequired: true })
  const agent = new FakeAgent({ header: { cwd: workspace } })
  const agents = { get: (id: string) => id === 'session-a' ? agent : undefined }
  const bridge = new WorkbenchAgentBridge(agents, scopes, new FakeRuntime(), browsers)
  try {
    const tab = await browsers.firstTab('session-a')
    await tab.setContent(`<!doctype html><style>#buy{border-radius:4px;font-size:18px}</style><button id="buy">Buy now</button>`)
    const selected = await tab.inspect('#buy')

    const result = await bridge.requestWebChange('session-a', {
      tabId: tab.id,
      selection: selected.selection,
      instruction: '这个按钮更年轻一点，圆角更大，字号稍微小一点',
    })
    assert.equal(result.changeSet.status, 'proposed')
    assert.equal(await readFile(path.join(workspace, 'button.css'), 'utf8'), '#buy { border-radius: 4px; font-size: 18px; }\n')

    const service = scopes.for({ sessionId: 'session-a', cwd: workspace })
    const review = await service.prepareReview(result.changeSet.id)
    assert.equal(review.diffs?.length, 1)
    for (const hunk of review.diffs![0]!.hunks) await service.reviewHunk(result.changeSet.id, 'button.css', hunk.id, 'accepted')
    const applied = await service.apply(result.changeSet.id)
    assert.equal(applied.status, 'applied')
    assert.equal(await readFile(path.join(workspace, 'button.css'), 'utf8'), '#buy { border-radius: 12px; font-size: 16px; }\n')
  } finally {
    await browsers.dispose()
  }
})
