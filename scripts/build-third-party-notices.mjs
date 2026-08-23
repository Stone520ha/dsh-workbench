import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'THIRD_PARTY_NOTICES.txt')
const roots = ['@canvas-harness/core', '@canvas-harness/react']

function requireFrom(dir) {
  return createRequire(pathToFileURL(path.join(dir, '__dsh_license_probe__.cjs')))
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function packageRoot(entry, expectedName) {
  let dir = path.dirname(entry)
  while (true) {
    const pkgFile = path.join(dir, 'package.json')
    if (fs.existsSync(pkgFile)) {
      const pkg = readJson(pkgFile)
      if (pkg.name === expectedName) return { dir, pkg, pkgFile }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`third-party notices: cannot find package root for ${expectedName} from ${entry}`)
}

function resolvePackage(name, fromDir) {
  const req = requireFrom(fromDir)
  let entry
  try {
    entry = req.resolve(name)
  } catch (error) {
    throw new Error(`third-party notices: cannot resolve ${name} from ${fromDir}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return packageRoot(entry, name)
}

function licenseText(dir) {
  const candidates = fs.readdirSync(dir)
    .filter(name => /^(licen[cs]e|copying|notice)(\.|$)/iu.test(name))
    .sort((a, b) => a.localeCompare(b))
  if (candidates.length === 0) return undefined
  return fs.readFileSync(path.join(dir, candidates[0]), 'utf8').trim()
}

const seen = new Map()

function visit(name, fromDir, optional = false) {
  let resolved
  try {
    resolved = resolvePackage(name, fromDir)
  } catch (error) {
    if (optional) return
    throw error
  }
  const key = `${resolved.pkg.name}@${resolved.pkg.version ?? 'unknown'}`
  if (seen.has(key)) return
  seen.set(key, {
    name: resolved.pkg.name,
    version: resolved.pkg.version ?? 'unknown',
    license: resolved.pkg.license ?? 'UNKNOWN',
    repository: typeof resolved.pkg.repository === 'string'
      ? resolved.pkg.repository
      : resolved.pkg.repository?.url,
    text: licenseText(resolved.dir),
  })

  for (const dep of Object.keys(resolved.pkg.dependencies ?? {})) visit(dep, resolved.dir)
  for (const dep of Object.keys(resolved.pkg.optionalDependencies ?? {})) visit(dep, resolved.dir, true)
}

for (const name of roots) visit(name, root)

const records = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
const lines = [
  'THIRD-PARTY SOFTWARE NOTICES',
  '============================',
  '',
  'This file is generated from the production dependency graph bundled into the DSH Infinite Canvas browser client.',
  'Packages supplied by the DSH host at runtime (for example React) are not bundled here and are therefore not listed as bundled components.',
  '',
]

for (const item of records) {
  lines.push('------------------------------------------------------------------------')
  lines.push(`${item.name} ${item.version}`)
  lines.push(`Declared license: ${item.license}`)
  if (item.repository) lines.push(`Repository: ${item.repository}`)
  lines.push('------------------------------------------------------------------------')
  lines.push('')
  lines.push(item.text ?? '[No license file was present in the installed package; see the declared license metadata above.]')
  lines.push('')
}

fs.writeFileSync(output, `${lines.join('\n')}\n`)
console.log(`built ${path.relative(root, output)} (${records.length} bundled packages)`)
