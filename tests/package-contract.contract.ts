import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

interface Registration { id: string; factory: (require: (specifier: string) => unknown) => Record<string, unknown> }

test('publish manifest declares a DSH dynamic client package and closed exports', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as any
  assert.equal(pkg.name, 'dsh-workbench')
  assert.equal(pkg.version, '0.4.0-beta.0')
  assert.notEqual(pkg.private, true)
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  const patch = await readFile('cordis.patch.yml', 'utf8')
  assert.match(patch, /id: dsh-workbench/)
  assert.match(patch, /name: dsh-workbench/)
})

test('lib/client.js registers one DSH loader factory and exposes only plugin entry face', async () => {
  const code = await readFile('lib/client.js', 'utf8')
  assert.doesNotMatch(code, /node:child_process|node:fs|@deepseek-ai\/dsh-host/u)
  let registration: Registration | undefined
  const sandbox = {
    __ModuleLoader__: {
      load(value: Registration) { registration = value },
    },
    console,
    URL,
    fetch: async () => { throw new Error('contract fixture fetch should not execute') },
  }
  vm.runInNewContext(code, sandbox, { filename: 'lib/client.js' })
  assert.ok(registration)
  assert.equal(registration!.id, 'dsh-workbench')
  const fakeReact = {
    createElement: () => null,
    useCallback: (fn: unknown) => fn,
    useEffect: () => undefined,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [value, () => undefined],
  }
  const exports = registration!.factory((specifier) => {
    if (specifier === 'react') return fakeReact
    throw new Error(`unexpected external ${specifier}`)
  })
  assert.deepEqual(Object.keys(exports).sort(), ['apply', 'inject'])
  assert.deepEqual(Array.from(exports.inject as string[]), ['slots'])
  assert.equal(typeof exports.apply, 'function')
})
