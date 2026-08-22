import test from 'node:test'
import assert from 'node:assert/strict'
import { BrowserSession } from '../src/browser/session.js'

const HTML = `<!doctype html><html><head><title>Workbench Fixture</title><style>#buy{font-size:18px;border-radius:4px;padding:8px}</style></head><body><main><button id="buy" class="primary">Buy now</button></main></body></html>`

test('Chromium vertical slice: tab -> document -> DOM selection -> version -> screenshot', { timeout: 20_000 }, async () => {
  const browser = new BrowserSession({ headless: true })
  try {
    const tab = await browser.firstTab()
    await tab.setContent(HTML)
    const title = await tab.evaluate<string>('document.title')
    assert.equal(title, 'Workbench Fixture')

    const selected = await tab.inspect('#buy')
    assert.equal(selected.element.tagName, 'BUTTON')
    assert.equal(selected.element.textContent, 'Buy now')
    assert.equal(selected.selection.kind, 'dom-node')
    assert.equal(selected.selection.selector, '#buy')
    assert.match(selected.selection.version, /^sha256:/)
    assert.equal(selected.selection.version, selected.artifact.version)
    assert.ok(selected.element.rect.width > 0)

    const png = await tab.screenshot()
    assert.ok(png.byteLength > 100)
    assert.deepEqual([...png.slice(0, 8)], [137,80,78,71,13,10,26,10])

    const tabs = await browser.tabs()
    assert.ok(tabs.some(row => row.id === tab.id))
  } finally {
    await browser.stop()
  }
})

test('Browser policy denies file URLs and non-allowlisted domains before navigation', async () => {
  const browser = new BrowserSession({ allowedDomains: ['127.0.0.1'] })
  try {
    const tab = await browser.firstTab()
    await assert.rejects(() => tab.navigate('file:///etc/passwd'), /scheme is not allowed/)
    await assert.rejects(() => tab.navigate('https://example.com/'), /outside the allowlist/)
  } finally {
    await browser.stop()
  }
})
