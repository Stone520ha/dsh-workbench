import fs from 'node:fs'
import path from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

async function loadTypeScript() {
  try {
    return (await import('typescript')).default
  } catch {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    return (await import(pathToFileURL(path.join(globalRoot, 'typescript/lib/typescript.js')).href)).default
  }
}
const ts = await loadTypeScript()

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entry = path.join(root, 'src/client/index.ts')
const out = path.join(root, 'lib/client.js')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const packageId = packageJson.name

// DSH seeds React in the browser module table. Everything else used by the
// infinite-canvas view is deliberately bundled into this one plugin artifact.
const allowedExternals = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'])
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)])
const modules = new Map()
const dependencyMap = new Map()

function posix(file) {
  return path.relative(root, file).split(path.sep).join('/')
}

function sourceCandidates(from, spec) {
  const raw = path.resolve(path.dirname(from), spec)
  const base = raw.replace(/\.js$/u, '')
  return [`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`, path.join(base, 'index.ts')]
}

function resolveSourceLocal(from, spec) {
  for (const file of sourceCandidates(from, spec)) if (fs.existsSync(file)) return file
  throw new Error(`client bundle: cannot resolve ${spec} from ${posix(from)}`)
}

function resolveRuntime(from, spec) {
  if (builtins.has(spec)) {
    throw new Error(`client bundle: browser dependency ${JSON.stringify(spec)} from ${posix(from)} is a Node builtin`)
  }
  try {
    return createRequire(pathToFileURL(from)).resolve(spec)
  } catch (error) {
    throw new Error(`client bundle: cannot resolve runtime dependency ${JSON.stringify(spec)} from ${posix(from)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function scanRequires(file, id, code, mode) {
  const deps = Object.create(null)
  for (const match of code.matchAll(/require\(["']([^"']+)["']\)/gu)) {
    const spec = match[1]
    if (allowedExternals.has(spec)) continue
    let resolved
    if (mode === 'source' && spec.startsWith('.')) {
      resolved = resolveSourceLocal(file, spec)
      compileSource(resolved)
    } else {
      resolved = resolveRuntime(file, spec)
      compileRuntime(resolved)
    }
    deps[spec] = posix(resolved)
  }
  dependencyMap.set(id, deps)
}

function compileSource(file) {
  file = path.resolve(file)
  const id = posix(file)
  if (modules.has(id)) return
  const source = fs.readFileSync(file, 'utf8')
  const result = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.React,
      esModuleInterop: false,
      sourceMap: false,
      inlineSourceMap: false,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
  if (errors.length) {
    throw new Error(`client bundle transpile failed for ${id}: ${errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`)
  }
  // Set before traversing dependencies so CJS/source cycles terminate.
  modules.set(id, result.outputText)
  scanRequires(file, id, result.outputText, 'source')
}

function compileRuntime(file) {
  file = path.resolve(file)
  const id = posix(file)
  if (modules.has(id)) return
  const ext = path.extname(file).toLowerCase()
  if (ext === '.json') {
    const json = fs.readFileSync(file, 'utf8').trim()
    const code = `module.exports = ${json};`
    modules.set(id, code)
    dependencyMap.set(id, Object.create(null))
    return
  }
  if (!['.js', '.cjs'].includes(ext)) {
    throw new Error(`client bundle: unsupported browser dependency ${posix(file)} (${ext || 'no extension'})`)
  }
  const source = fs.readFileSync(file, 'utf8')
  // Browser-first packages occasionally inspect process.env.NODE_ENV even in
  // their CJS build. Give bundled dependencies a tiny local shim without
  // exposing Node's process object to plugin code.
  const code = `var process = globalThis.process || { env: { NODE_ENV: 'production' } };\n${source}`
  modules.set(id, code)
  scanRequires(file, id, code, 'runtime')
}

compileSource(entry)

const moduleTable = [...modules].map(([id, code]) => {
  return `${JSON.stringify(id)}: function(module, exports, require, __filename, __dirname) {\n${code}\n}`
}).join(',\n')

const depsObject = Object.fromEntries([...dependencyMap].map(([id, deps]) => [id, deps]))
const dependencyTable = JSON.stringify(depsObject)

const bundle = `/* dsh infinite-canvas browser bundle: generated by scripts/build-client-bundle.mjs */\n(function () {\n  'use strict';\n  var target = globalThis.__ModuleLoader__;\n  if (!target || typeof target.load !== 'function') throw new Error('dsh infinite canvas: __ModuleLoader__.load is unavailable');\n  target.load({\n    id: ${JSON.stringify(packageId)},\n    factory: function (externalRequire) {\n      var modules = {\n${moduleTable}\n      };\n      var dependencies = ${dependencyTable};\n      var cache = Object.create(null);\n      function dirname(id) {\n        var at = id.lastIndexOf('/');\n        return at < 0 ? '.' : id.slice(0, at);\n      }\n      function load(id) {\n        if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id].exports;\n        var body = modules[id];\n        if (typeof body !== 'function') throw new Error('dsh infinite canvas: unknown bundled module ' + id);\n        var module = { exports: {} };\n        cache[id] = module;\n        body(module, module.exports, function (spec) {\n          var table = dependencies[id];\n          var resolved = table && table[spec];\n          if (resolved) return load(resolved);\n          return externalRequire(spec);\n        }, id, dirname(id));\n        return module.exports;\n      }\n      return load('src/client/index.ts');\n    }\n  });\n})();\n`

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, bundle)

// The dynamic loader consumes only lib/client.js. Keep declarations but remove
// modular browser JS so the published artifact has one browser execution face.
for (const dir of [path.join(root, 'lib/client')]) {
  if (!fs.existsSync(dir)) continue
  for (const name of fs.readdirSync(dir)) if (name.endsWith('.js')) fs.rmSync(path.join(dir, name))
}
console.log(`built ${path.relative(root, out)} (${Buffer.byteLength(bundle)} bytes, ${modules.size} modules)`)
