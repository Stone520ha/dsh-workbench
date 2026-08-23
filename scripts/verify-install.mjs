import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const pack = JSON.parse(execFileSync('npm', ['pack', '--json'], { cwd: root, encoding: 'utf8' }))[0]
const tarball = path.join(root, pack.filename)
const fixture = mkdtempSync(path.join(tmpdir(), 'dsh-infinite-canvas-install-'))
writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'dsh-install-fixture', version: '1.0.0', private: true, type: 'module' }))
execFileSync('npm', ['install', '--offline', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], { cwd: fixture, stdio: 'pipe' })

const installed = path.join(fixture, 'node_modules/dsh-workbench')
for (const relative of [
  'package.json',
  'cordis.patch.yml',
  'THIRD_PARTY_NOTICES.txt',
  'lib/index.js',
  'lib/client.js',
  'lib/client/index.d.ts',
]) {
  if (!existsSync(path.join(installed, relative))) throw new Error(`installed package missing ${relative}`)
}
const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('installed package lost dsh.bundle manifest')
if (JSON.stringify(manifest.dsh?.client?.inject) !== JSON.stringify(['@deepseek-ai/dsh-client-ui-conversation'])) {
  throw new Error('installed package has unexpected DSH client dependencies')
}
if (!existsSync(path.join(fixture, 'node_modules/@canvas-harness/core'))) throw new Error('canvas-harness core dependency was not installed')
if (!existsSync(path.join(fixture, 'node_modules/@canvas-harness/react'))) throw new Error('canvas-harness React dependency was not installed')

const notices = readFileSync(path.join(installed, 'THIRD_PARTY_NOTICES.txt'), 'utf8')
if (!notices.includes('@canvas-harness/core') || !notices.includes('@canvas-harness/react')) {
  throw new Error('installed package lost canvas-harness license notices')
}

// The Host half is intentionally inert. If importing/applying it starts
// browser, HTTP, Agent or filesystem machinery, the MVP boundary has regressed.
const entry = await import(pathToFileURL(path.join(installed, 'lib/index.js')).href)
if (entry.name !== 'dsh-workbench') throw new Error('Host entry exported wrong plugin name')
if (!Array.isArray(entry.inject) || entry.inject.length !== 0) throw new Error('Canvas MVP Host entry must have no injected runtime services')
let touched = false
const inertCtx = new Proxy({}, {
  get() { touched = true; throw new Error('Canvas MVP Host entry touched a DSH runtime service') },
})
entry.apply(inertCtx)
if (touched) throw new Error('Canvas MVP Host entry was not inert')

execFileSync('npm', ['uninstall', '--offline', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', 'dsh-workbench'], { cwd: fixture, stdio: 'pipe' })
if (existsSync(installed)) throw new Error('package directory remains after uninstall')

console.log(JSON.stringify({
  tarball: pack.filename,
  packedFiles: pack.entryCount,
  install: 'PASS',
  hostBoundary: 'PASS',
  canvasDependencies: 'PASS',
  licenseNotices: 'PASS',
  uninstall: 'PASS',
}, null, 2))

rmSync(fixture, { recursive: true, force: true })
