import test from 'node:test'
import assert from 'node:assert/strict'
import { codeIdentity, codePathOfCanvasNode, codeRangeLabel, codeReferences } from '../src/client/code-context.js'

test('ReadResultView projects exact path, range, language and numbered lines', () => {
  const refs = codeReferences({
    kind: 'tool-call',
    data: {
      root: {
        kind: 'tool-result',
        isError: false,
        resultView: {
          card: 'read',
          title: 'Read src/chair.ts',
          path: 'src/chair.ts',
          offset: 21,
          totalLines: 120,
          lang: 'ts',
          lines: [
            { number: 21, text: 'export interface Chair {' },
            { number: 22, text: '  legs: number' },
            { number: 23, text: '}' },
          ],
        },
      },
    },
  })

  assert.deepEqual(refs, [{
    path: 'src/chair.ts',
    offset: 21,
    totalLines: 120,
    lang: 'ts',
    title: 'Read src/chair.ts',
    lines: [
      { number: 21, text: 'export interface Chair {' },
      { number: 22, text: '  legs: number' },
      { number: 23, text: '}' },
    ],
  }])
  assert.equal(codeIdentity(refs[0]!), 'src/chair.ts#L21')
  assert.equal(codeRangeLabel(refs[0]!), 'lines 21-23')
})

test('failed, non-read and malformed read views do not become Code Nodes', () => {
  assert.deepEqual(codeReferences({
    kind: 'tool-call',
    data: { root: { kind: 'tool-result', isError: true, resultView: { card: 'read', path: 'x.ts', offset: 1, totalLines: 1, lines: [] } } },
  }), [])
  assert.deepEqual(codeReferences({
    kind: 'tool-call',
    data: { root: { kind: 'tool-result', resultView: { card: 'web', kind: 'fetch', url: 'https://example.com' } } },
  }), [])
  assert.deepEqual(codeReferences({
    kind: 'tool-call',
    data: { root: { kind: 'tool-result', resultView: { card: 'read', path: '', offset: 0, totalLines: -1, lines: [] } } },
  }), [])
})

test('Canvas Code Node keeps canonical model-facing file path independently of display text', () => {
  assert.equal(codePathOfCanvasNode({ data: { localKind: 'code', path: 'src/app.ts' } }), 'src/app.ts')
  assert.equal(codePathOfCanvasNode({ data: { localKind: 'file', path: 'src/app.ts' } }), undefined)
})

test('empty read windows keep their requested offset as the range label', () => {
  const [ref] = codeReferences({
    kind: 'tool-call',
    data: { root: { kind: 'tool-result', resultView: { card: 'read', path: 'README.md', offset: 400, totalLines: 220, lines: [] } } },
  })
  assert.ok(ref)
  assert.equal(codeRangeLabel(ref), 'from line 400')
})
