import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserSessionRegistry } from '../src/server/browser-registry.js'
import { WorkbenchScopeRegistry } from '../src/server/scope-registry.js'
import { WorkbenchRpcRouter } from '../src/server/rpc.js'

const HTML = '<!doctype html><html><body><button id="target">Target</button></body></html>'

test('transport-neutral RPC exposes session-bound Chromium preview/point-inspection/diagnostics', { timeout: 30_000 }, async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'workbench-rpc-browser-'))
  const cwd = await mkdtemp(path.join(tmpdir(), 'workbench-rpc-cwd-'))
  const browsers = new BrowserSessionRegistry({ stateDir, browser: { headless: true } })
  const scopes = new WorkbenchScopeRegistry({ stateDir, reviewRequired: true })
  const agent = { session: { header: { cwd } } }
  const agents = { get: (id: any) => id === 's1' ? agent as any : undefined }
  const noBridge = { requestWebChange: async () => { throw new Error('unused') }, requestChange: async () => { throw new Error('unused') } } as any
  const router = new WorkbenchRpcRouter(agents, scopes, browsers, noBridge)
  try {
    const tab = await browsers.firstTab('s1')
    await tab.setContent(HTML)
    await router.call({ sessionId: 's1', method: 'browser.startObservability', args: { tabId: tab.id } })
    await tab.evaluate(`console.log('rpc-console')`)
    await new Promise(resolve => setTimeout(resolve, 30))
    const preview = await router.call({ sessionId: 's1', method: 'browser.preview', args: { tabId: tab.id } }) as any
    assert.equal(preview.artifact.kind, 'web')
    assert.ok(preview.screenshotBase64.length > 100)
    const target = await tab.inspect('#target')
    const picked = await router.call({ sessionId: 's1', method: 'browser.inspectPoint', args: {
      tabId: tab.id,
      x: target.element.rect.x + target.element.rect.width / 2,
      y: target.element.rect.y + target.element.rect.height / 2,
    } }) as any
    assert.equal(picked.element.selector, '#target')
    const consoleEntries = await router.call({ sessionId: 's1', method: 'browser.console', args: { tabId: tab.id } }) as any[]
    assert.ok(consoleEntries.some(entry => entry.text.includes('rpc-console')))
    await assert.rejects(() => router.call({ sessionId: 'other', method: 'browser.tabs' }), /Session is not live/)
  } finally {
    await browsers.dispose()
  }
})
