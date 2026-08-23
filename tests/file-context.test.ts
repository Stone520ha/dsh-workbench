import test from 'node:test'
import assert from 'node:assert/strict'
import { fileBasename, producedFilePaths, resolveHostFilePath } from '../src/client/file-context.js'

test('successful diff tool node projects deduped produced file paths', () => {
  assert.deepEqual(producedFilePaths({
    kind: 'tool-call',
    data: {
      root: {
        kind: 'tool-result',
        isError: false,
        callView: {
          card: 'diff',
          locations: [
            { path: 'src/chair.ts' },
            { path: 'src/table.ts' },
            { path: 'src/chair.ts' },
          ],
        },
      },
    },
  }), ['src/chair.ts', 'src/table.ts'])
})

test('generic edit produces files while reads and failed mutations do not', () => {
  assert.deepEqual(producedFilePaths({
    kind: 'tool-call',
    data: {
      root: {
        kind: 'tool-result',
        callView: { card: 'generic', kind: 'edit', locations: [{ path: 'notes.md' }] },
      },
    },
  }), ['notes.md'])

  assert.deepEqual(producedFilePaths({
    kind: 'tool-call',
    data: {
      root: {
        kind: 'tool-result',
        callView: { card: 'generic', kind: 'read', locations: [{ path: 'notes.md' }] },
      },
    },
  }), [])

  assert.deepEqual(producedFilePaths({
    kind: 'tool-call',
    data: {
      root: {
        kind: 'tool-result',
        isError: true,
        callView: { card: 'diff', locations: [{ path: 'broken.ts' }] },
      },
    },
  }), [])
})

test('file paths resolve against Session cwd without mangling absolute or Windows paths', () => {
  assert.equal(resolveHostFilePath('/work/project', 'src/app.ts'), '/work/project/src/app.ts')
  assert.equal(resolveHostFilePath('/work/project/', './notes.md'), '/work/project/./notes.md')
  assert.equal(resolveHostFilePath('/work/project', '/tmp/out.pdf'), '/tmp/out.pdf')
  assert.equal(resolveHostFilePath('C:\\work\\project', 'src\\app.ts'), 'C:\\work\\project/src\\app.ts')
  assert.equal(resolveHostFilePath('/work/project', 'D:\\out\\report.docx'), 'D:\\out\\report.docx')
  assert.equal(resolveHostFilePath('/work/project', '\\\\server\\share\\file.txt'), '\\\\server\\share\\file.txt')
  assert.equal(fileBasename('/work/project/report.pdf'), 'report.pdf')
  assert.equal(fileBasename('C:\\work\\chair.step'), 'chair.step')
})
