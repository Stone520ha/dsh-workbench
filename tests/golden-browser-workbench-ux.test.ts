import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserSessionRegistry } from '../src/server/browser-registry.js'
import { WorkbenchScopeRegistry } from '../src/server/scope-registry.js'
import { WorkbenchAgentBridge, type WorkbenchAgentLike, type WorkbenchAgentRuntimeAdapter, type WorkbenchAgentTaskContext, type WorkbenchProposalInput } from '../src/server/agent-bridge.js'
import { WorkbenchRpcRouter } from '../src/server/rpc.js'
import { BrowserWorkbenchController } from '../src/client/controller.js'
import type { WorkbenchClientTransport } from '../src/client/transport.js'
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
  injected?: unknown
  constructor(readonly session: { header: { cwd?: string } }) {}
  inject(message: unknown): void { this.injected = message }
  followup(message: unknown): void {
    const instruction = String(message)
    this.task = (async () => {
      assert.match(this.guard?.({ name: 'write' }) ?? '', /Workbench review mode/)
      if (this.proposal === undefined) throw new Error('proposal tool missing')
      const radius = instruction.includes('8px') ? '8px' : '12px'
      await this.proposal({
        reason: 'refine selected buy button',
        patches: [{ kind: 'update', path: 'button.css', content: `#buy { border-radius: ${radius}; font-size: 16px; }\n` }],
      })
    })()
  }
  whenIdle(): Promise<void> { return this.task }
}

function page(css: string): string {
  return `<!doctype html><html><head><style>${css}</style></head><body><button id="buy">Buy now</button></body></html>`
}

test('Golden UX: preview click -> Agent proposal -> hunk review -> apply -> visual refresh -> undo', { timeout: 60_000 }, async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'workbench-golden-browser-'))
  const stateDir = await mkdtemp(path.join(tmpdir(), 'workbench-golden-browser-state-'))
  const oldCss = '#buy { border-radius: 4px; font-size: 18px; }\n'
  await writeFile(path.join(workspace, 'button.css'), oldCss)

  const browsers = new BrowserSessionRegistry({ stateDir, browser: { headless: true } })
  const scopes = new WorkbenchScopeRegistry({ stateDir, reviewRequired: true })
  const agent = new FakeAgent({ header: { cwd: workspace } })
  const agents = { get: (id: string) => id === 'session-a' ? agent : undefined }
  const bridge = new WorkbenchAgentBridge(agents, scopes, new FakeRuntime(), browsers)
  const router = new WorkbenchRpcRouter(agents, scopes, browsers, bridge)

  const tab = await browsers.firstTab('session-a')
  await tab.setContent(page(oldCss))
  const target = await tab.inspect('#buy')

  // Simulate a live dev server/HMR boundary. The managed CI Chromium blocks
  // HTTP navigation, so after apply/restore this transport re-renders the page
  // from the real workspace file before returning the real CDP preview.
  const transport: WorkbenchClientTransport = {
    async call<T>(sessionId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
      if (method === 'browser.reload') {
        const css = await readFile(path.join(workspace, 'button.css'), 'utf8')
        const live = await browsers.getTab(sessionId, String(args.tabId))
        await live.setContent(page(css))
        return await live.preview() as T
      }
      return await router.call({ sessionId, method, args }) as T
    },
  }

  const controller = new BrowserWorkbenchController('session-a', transport)
  try {
    await controller.init()
    let state = controller.snapshot()
    assert.equal(state.ready, true)
    assert.equal(state.preview?.artifact.kind, 'web')

    const viewport = state.preview!.viewport
    const xRatio = (target.element.rect.x + target.element.rect.width / 2) / viewport.width
    const yRatio = (target.element.rect.y + target.element.rect.height / 2) / viewport.height
    await controller.inspectNormalized(xRatio, yRatio)
    state = controller.snapshot()
    assert.equal(state.selected?.element.selector, '#buy')

    controller.setInstruction('这个按钮更年轻一点，圆角更大，字号稍微小一点')
    await controller.askAgent()
    state = controller.snapshot()
    assert.equal(state.surface, 'changes')
    assert.equal(state.changeSet?.status, 'proposed')
    assert.equal(await readFile(path.join(workspace, 'button.css'), 'utf8'), oldCss, 'review must not mutate the workspace')

    const diff = state.changeSet!.diffs![0]!
    assert.ok(diff.hunks.length >= 1)
    for (const hunk of diff.hunks) await controller.reviewHunk(diff.path, hunk.id, 'accepted')
    await controller.applyReviewed()

    state = controller.snapshot()
    assert.equal(state.surface, 'browser')
    assert.ok(state.lastCheckpointId)
    assert.equal(await readFile(path.join(workspace, 'button.css'), 'utf8'), '#buy { border-radius: 12px; font-size: 16px; }\n')
    const after = await tab.inspect('#buy')
    assert.equal(after.element.styles.borderRadius, '12px')
    assert.equal(after.element.styles.fontSize, '16px')

    await controller.undoLastApply()
    assert.equal(await readFile(path.join(workspace, 'button.css'), 'utf8'), oldCss)
    const restored = await tab.inspect('#buy')
    assert.equal(restored.element.styles.borderRadius, '4px')
    assert.equal(restored.element.styles.fontSize, '18px')
  } finally {
    await browsers.dispose()
  }
})
