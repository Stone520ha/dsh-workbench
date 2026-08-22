import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WorkbenchHostRuntime } from '../src/server/host-runtime.js'
import type { WorkbenchAgentLike, WorkbenchAgentRuntimeAdapter, WorkbenchProposalInput } from '../src/server/agent-bridge.js'
import type { ChangeSet } from '../src/core/types.js'

class NoopRuntime implements WorkbenchAgentRuntimeAdapter {
  installProposalTool(_agent: WorkbenchAgentLike, _onProposal: (input: WorkbenchProposalInput) => Promise<ChangeSet>) { return () => undefined }
  makeContextMessage(value: unknown) { return value }
  makeFollowupMessage(value: unknown) { return value }
}

async function waitFor(predicate: () => boolean, timeout = 5000) {
  const end = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > end) throw new Error('condition timed out')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test('Host runtime unload removes route, listener, scopes and Session Chromium', { timeout: 30_000 }, async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'workbench-life-state-'))
  const cwd = await mkdtemp(path.join(tmpdir(), 'workbench-life-cwd-'))
  const agent = { id: 's1', session: { header: { cwd } } } as any
  let routeActive = false
  let routeDisposals = 0
  let listener: ((payload: any) => void) | undefined
  let listenerDisposals = 0
  const ctx = {
    agents: { get: (id: any) => id === 's1' ? agent : undefined },
    webServer: {
      register() { routeActive = true; return () => { routeActive = false; routeDisposals++ } },
    },
    on(_event: 'agent/disposed', fn: (payload: any) => void) {
      listener = fn
      return () => { listener = undefined; listenerDisposals++ }
    },
  }
  const runtime = new WorkbenchHostRuntime(ctx as any, { stateDir, browser: { headless: true } }, new NoopRuntime())
  runtime.start()
  assert.equal(routeActive, true)
  runtime.scopes.for({ sessionId: 's1', cwd })
  assert.deepEqual(runtime.scopes.activeSessionIds(), ['s1'])
  await runtime.browsers.firstTab('s1')
  assert.deepEqual(runtime.browsers.activeSessionIds(), ['s1'])

  listener?.({ agent })
  assert.deepEqual(runtime.scopes.activeSessionIds(), [])
  await waitFor(() => runtime.browsers.activeSessionIds().length === 0)

  await runtime.dispose()
  assert.equal(routeActive, false)
  assert.equal(routeDisposals, 1)
  assert.equal(listenerDisposals, 1)
  assert.deepEqual(runtime.scopes.activeSessionIds(), [])
  assert.deepEqual(runtime.browsers.activeSessionIds(), [])
  await runtime.dispose()
  assert.equal(routeDisposals, 1, 'dispose must be idempotent')
  assert.throws(() => runtime.start(), /disposed/)
})
