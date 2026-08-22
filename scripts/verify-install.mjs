import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const pack = JSON.parse(execFileSync('npm', ['pack', '--json'], { cwd: root, encoding: 'utf8' }))[0]
const tarball = path.join(root, pack.filename)
const fixture = mkdtempSync(path.join(tmpdir(), 'dsh-workbench-install-'))
writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'dsh-install-fixture', version: '1.0.0', private: true, type: 'module' }))
execFileSync('npm', ['install', '--offline', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], { cwd: fixture, stdio: 'pipe' })

const installed = path.join(fixture, 'node_modules/dsh-workbench')
for (const relative of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/client/index.d.ts']) {
  if (!existsSync(path.join(installed, relative))) throw new Error(`installed package missing ${relative}`)
}
const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('installed package lost dsh.bundle manifest')

// Minimal runtime stubs for the two value imports used while the Host entry is
// materialized. This checks the shipped ESM graph and plugin lifecycle without
// pretending to be a full DSH runtime.
function fakePackage(name, source) {
  const dir = path.join(fixture, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.1.1-rc.2', type: 'module', exports: './index.js' }))
  writeFileSync(path.join(dir, 'index.js'), source)
}
fakePackage('@deepseek-ai/dsh-tools', 'export const defineTool = (value) => value;\n')
fakePackage('@deepseek-ai/dsh-llm', 'export const createUserMessage = (value) => ({...value, id:"fixture", role:"user"});\n')

const entry = await import(pathToFileURL(path.join(installed, 'lib/index.js')).href)
if (entry.name !== 'dsh-workbench') throw new Error('Host entry exported wrong plugin name')
if (!Array.isArray(entry.inject) || !entry.inject.includes('agents') || !entry.inject.includes('webServer')) throw new Error('Host entry inject contract is incomplete')
let routeActive = false
let listenerActive = false
const cleanup = []
const ctx = {
  agents: { get: () => undefined },
  webServer: { register: () => { routeActive = true; return () => { routeActive = false } } },
  on: () => { listenerActive = true; return () => { listenerActive = false } },
  effect(setup) { const dispose = setup(); if (dispose) cleanup.push(dispose); return () => undefined },
}
entry.apply(ctx, { stateDir: path.join(fixture, 'state') })
if (!routeActive || !listenerActive) throw new Error('installed Host entry did not activate route/listener')
for (const dispose of cleanup.reverse()) await dispose()
if (routeActive || listenerActive) throw new Error('installed Host entry left route/listener active after disposal')

execFileSync('npm', ['uninstall', '--offline', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', 'dsh-workbench'], { cwd: fixture, stdio: 'pipe' })
if (existsSync(installed)) throw new Error('package directory remains after uninstall')

console.log(JSON.stringify({
  tarball: pack.filename,
  packedFiles: pack.entryCount,
  install: 'PASS',
  hostEntrySmoke: 'PASS',
  lifecycleCleanup: 'PASS',
  uninstall: 'PASS',
}, null, 2))

rmSync(fixture, { recursive: true, force: true })
