import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { isLoopbackAddress, registerWorkbenchHttpRoute } from '../src/server/http-route.js'

async function withServer(run: (base: string) => Promise<void>) {
  let handler: any
  const registrar = { register(route: any) { handler = route.handler; return () => { handler = undefined } } }
  const router = { async call(request: any) { return { sessionId: request.sessionId, method: request.method } } } as any
  const dispose = registerWorkbenchHttpRoute(registrar, router, { maxBodyBytes: 1024 })
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server address unavailable')
  const base = `http://127.0.0.1:${address.port}`
  try { await run(base) } finally {
    dispose()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

test('installable HTTP transport is same-origin, JSON-only, bounded and no-store', async () => {
  await withServer(async base => {
    const ok = await fetch(`${base}/api/dsh-workbench/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ sessionId: 's1', method: 'browser.tabs' }),
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(await ok.json(), { ok: true, value: { sessionId: 's1', method: 'browser.tabs' } })

    const cross = await fetch(`${base}/api/dsh-workbench/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ sessionId: 's1', method: 'browser.tabs' }),
    })
    assert.equal(cross.status, 403)
    assert.equal((await cross.json() as any).error.code, 'ORIGIN_DENIED')

    const media = await fetch(`${base}/api/dsh-workbench/call`, { method: 'POST', body: '{}' })
    assert.equal(media.status, 415)

    const huge = await fetch(`${base}/api/dsh-workbench/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ sessionId: 's1', method: 'x', args: { value: 'x'.repeat(2000) } }),
    })
    assert.equal(huge.status, 413)
    assert.equal((await huge.json() as any).error.code, 'BODY_TOO_LARGE')
  })
})


test('loopback classifier fails closed for remote/unknown addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('127.7.8.9'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('192.168.1.20'), false)
  assert.equal(isLoopbackAddress('10.0.0.2'), false)
  assert.equal(isLoopbackAddress(undefined), false)
})
