import test from 'node:test'
import assert from 'node:assert/strict'
import { BrowserSession } from '../src/browser/session.js'

const HTML = `<!doctype html><html><head><title>Inspector</title></head><body><section><button id="target" class="cta">Select me</button></section></body></html>`

test('CDP interactive inspector returns a versioned DOM selection without postMessage', { timeout: 20_000 }, async () => {
  const browser = new BrowserSession({ headless: true })
  try {
    const tab = await browser.firstTab()
    await tab.setContent(HTML)
    const picking = tab.pickElement(5_000)
    await new Promise(resolve => setTimeout(resolve, 50))
    await tab.evaluate(`document.querySelector('#target').click()`)
    const result = await picking
    assert.equal(result.element.selector, '#target')
    assert.equal(result.element.textContent, 'Select me')
    assert.equal(result.selection.selector, '#target')
    assert.equal(result.selection.version, result.artifact.version)
  } finally {
    await browser.stop()
  }
})

test('bounded console capture records page console messages', { timeout: 20_000 }, async () => {
  const browser = new BrowserSession({ headless: true })
  try {
    const tab = await browser.firstTab()
    await tab.startObservability()
    await tab.setContent(HTML)
    await tab.evaluate(`console.log('workbench-console', 42)`)
    await new Promise(resolve => setTimeout(resolve, 30))
    const entries = tab.consoleEntries()
    assert.ok(entries.some(entry => entry.text.includes('workbench-console') && entry.text.includes('42')))
  } finally {
    await browser.stop()
  }
})
