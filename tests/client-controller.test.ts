import test from 'node:test'
import assert from 'node:assert/strict'
import { BrowserWorkbenchController } from '../src/client/controller.js'
import { buildWorkbenchViewModel } from '../src/client/view-model.js'
import type { WorkbenchClientTransport } from '../src/client/transport.js'
import type { ChangeSet } from '../src/core/types.js'

const selection = {
  artifact: { id: 'web:https://example.test', uri: 'https://example.test', kind: 'web' as const, version: 'v1' },
  selection: { kind: 'dom-node' as const, artifactId: 'web:https://example.test', version: 'v1', selector: '#buy', url: 'https://example.test' },
  element: {
    selector: '#buy', tagName: 'BUTTON', id: 'buy', className: 'cta', textContent: 'Buy',
    rect: { x: 10, y: 20, width: 100, height: 40, top: 20, left: 10 },
    styles: { fontSize: '18px', borderRadius: '4px' },
  },
}

function proposed(id = 'c1'): ChangeSet {
  return {
    id, reason: 'change button', status: 'proposed', createdAt: 1,
    patches: [{ kind: 'update', path: 'button.css', baseVersion: 'base', content: 'new' }],
    diffs: [{
      path: 'button.css', oldText: 'old\n', newText: 'new\n', hunks: [{
        id: 'h1', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, baseStart: 0, baseEnd: 1,
        replacementLines: ['new', ''], lines: [{ type: 'delete', text: 'old', oldLine: 1 }, { type: 'add', text: 'new', newLine: 1 }],
      }],
    }],
    reviews: [{ path: 'button.css', decisions: { h1: 'pending' } }],
  }
}

test('client controller maps screenshot clicks to CSS viewport points and supports review comments/revision', async () => {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = []
  let change = proposed()
  const transport: WorkbenchClientTransport = {
    async call<T>(_sessionId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
      calls.push({ method, args })
      if (method === 'browser.tabs') return [{ id: 't1', title: 'Demo', url: 'https://example.test', type: 'page' }] as T
      if (method === 'browser.startObservability') return { started: true } as T
      if (method === 'browser.preview') return { artifact: selection.artifact, url: selection.artifact.uri, title: 'Demo', viewport: { width: 1000, height: 500, deviceScaleFactor: 1 }, screenshotBase64: 'abc' } as T
      if (method === 'browser.inspectPoint') return selection as T
      if (method === 'agent.webChange') return { taskId: 'task', changeSet: change } as T
      if (method === 'changes.prepare') return change as T
      if (method === 'changes.reviewHunk') {
        change = structuredClone(change)
        change.reviews![0]!.decisions.h1 = args.decision as 'accepted' | 'rejected'
        return change as T
      }
      if (method === 'changes.reject') return { ...change, status: 'rejected' } as T
      throw new Error(`unexpected ${method}`)
    },
  }
  const controller = new BrowserWorkbenchController('s1', transport)
  await controller.init()
  await controller.inspectNormalized(.25, .5)
  const point = calls.find(call => call.method === 'browser.inspectPoint')!
  assert.equal(point.args.x, 250)
  assert.equal(point.args.y, 250)

  controller.setInstruction('make it younger')
  await controller.askAgent()
  let vm = buildWorkbenchViewModel(controller.snapshot())
  assert.equal(vm.selectedLabel, 'button#buy.cta')
  assert.equal(vm.pendingHunks, 1)
  assert.equal(vm.canApply, false)

  controller.setComment('h1', 'Use 8px radius, not 12px')
  change = proposed('c2')
  await controller.reviseFromComments()
  const agentCalls = calls.filter(call => call.method === 'agent.webChange')
  assert.equal(agentCalls.length, 2)
  assert.match(String(agentCalls[1]!.args.instruction), /Use 8px radius/)

  await controller.reviewHunk('button.css', 'h1', 'accepted')
  vm = buildWorkbenchViewModel(controller.snapshot())
  assert.equal(vm.canApply, true)
})
