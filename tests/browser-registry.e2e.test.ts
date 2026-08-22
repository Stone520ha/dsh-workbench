import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserSessionRegistry } from '../src/server/browser-registry.js'

const A = `<!doctype html><title>A</title><button id="x">A</button>`
const B = `<!doctype html><title>B</title><button id="x">B</button>`

test('browser registry isolates tabs/processes per DSH session', { timeout: 30_000 }, async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'workbench-browser-registry-'))
  const registry = new BrowserSessionRegistry({ stateDir, browser: { headless: true } })
  try {
    const tabA = await registry.firstTab('session-a')
    const tabB = await registry.firstTab('session-b')
    await tabA.setContent(A)
    await tabB.setContent(B)
    assert.equal(await tabA.evaluate('document.title'), 'A')
    assert.equal(await tabB.evaluate('document.title'), 'B')
    await assert.rejects(() => registry.getTab('session-a', tabB.id), /Unknown browser tab/)
  } finally {
    await registry.dispose()
  }
})

test('DOM selection fails closed after page content changes', { timeout: 20_000 }, async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'workbench-browser-version-'))
  const registry = new BrowserSessionRegistry({ stateDir, browser: { headless: true } })
  try {
    const tab = await registry.firstTab('session-a')
    await tab.setContent(A)
    const selected = await tab.inspect('#x')
    await registry.validateSelection('session-a', tab.id, selected.selection)
    await tab.evaluate(`document.querySelector('#x').textContent = 'changed'`)
    await assert.rejects(
      () => registry.validateSelection('session-a', tab.id, selected.selection),
      /DOM selection is stale/,
    )
  } finally {
    await registry.dispose()
  }
})
