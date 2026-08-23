import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

interface Registration { id: string; factory: (require: (specifier: string) => unknown) => Record<string, unknown> }

test('publish manifest declares a canvas-only DSH dynamic client package', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as any
  assert.equal(pkg.name, 'dsh-workbench')
  assert.equal(pkg.version, '0.4.0-beta.0')
  assert.notEqual(pkg.private, true)
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-conversation'])
  assert.ok(pkg.files.includes('THIRD_PARTY_NOTICES.txt'))
  const patch = await readFile('cordis.patch.yml', 'utf8')
  assert.match(patch, /id: dsh-workbench/)
  assert.match(patch, /name: dsh-workbench/)
  const notices = await readFile('THIRD_PARTY_NOTICES.txt', 'utf8')
  assert.match(notices, /@canvas-harness\/core/u)
  assert.match(notices, /@canvas-harness\/react/u)
  assert.match(notices, /MIT/u)
})

test('Host entry is inert and does not create a second runtime', async () => {
  const entry = await import(pathToFileURL(path.resolve('lib/index.js')).href)
  assert.equal(entry.name, 'dsh-workbench')
  assert.deepEqual(Array.from(entry.inject as readonly string[]), [])
  let touched = false
  entry.apply(new Proxy({}, {
    get() { touched = true; throw new Error('canvas MVP Host entry must not touch DSH services') },
  }) as never)
  assert.equal(touched, false)
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

  // Mirror the DSH web shell's static module seed rather than maintaining a
  // tiny React mock. canvas-harness legitimately imports jsx-runtime and may
  // initialize React context at module load even though no Canvas is mounted.
  const React = await import('react')
  const ReactJsxRuntime = await import('react/jsx-runtime')
  const ReactDom = await import('react-dom')
  const ReactDomClient = await import('react-dom/client')
  const externals: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': ReactJsxRuntime,
    'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
  }

  const exports = registration!.factory((specifier) => {
    if (specifier in externals) return externals[specifier]
    throw new Error(`unexpected external ${specifier}`)
  })
  assert.deepEqual(Object.keys(exports).sort(), ['apply', 'inject'])
  assert.deepEqual(Array.from(exports.inject as string[]), ['slots'])
  assert.equal(typeof exports.apply, 'function')
})
