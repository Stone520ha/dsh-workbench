import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalWebUrl, webHostLabel, webReferences, webUrlOfCanvasNode } from '../src/client/web-context.js'

test('web_search projects structured sources, normalizes URLs and dedupes page identity', () => {
  assert.deepEqual(webReferences({
    kind: 'tool-call',
    data: {
      root: {
        kind: 'tool-result',
        isError: false,
        resultView: {
          card: 'web',
          kind: 'search',
          truncated: true,
          sources: [
            {
              url: 'https://example.com:443/chairs?q=oak#section-1',
              title: 'Oak chairs',
              snippet: '  Solid oak options.  ',
              publishedAt: '2026-08-20T10:00:00Z',
            },
            { url: 'https://example.com/chairs?q=oak#section-2', title: 'duplicate fragment' },
            { url: 'javascript:alert(1)', title: 'nope' },
          ],
        },
      },
    },
  }), [{
    url: 'https://example.com/chairs?q=oak',
    source: 'search',
    title: 'Oak chairs',
    snippet: 'Solid oak options.',
    publishedAt: '2026-08-20T10:00:00Z',
    truncated: true,
  }])
})

test('web_fetch projects final navigable URL and retrieval status', () => {
  assert.deepEqual(webReferences({
    kind: 'tool-call',
    data: {
      root: {
        kind: 'tool-result',
        resultView: {
          card: 'web',
          kind: 'fetch',
          title: 'Fetched product page',
          url: 'http://example.com:80/product#details',
          statusCode: 200,
          truncated: false,
        },
      },
    },
  }), [{
    url: 'http://example.com/product',
    source: 'fetch',
    title: 'Fetched product page',
    statusCode: 200,
    truncated: false,
  }])
})

test('failed/non-web tools and unsafe URL schemes do not become Web Nodes', () => {
  assert.deepEqual(webReferences({
    kind: 'tool-call',
    data: { root: { kind: 'tool-result', isError: true, resultView: { card: 'web', kind: 'fetch', url: 'https://x.test' } } },
  }), [])
  assert.deepEqual(webReferences({
    kind: 'tool-call',
    data: { root: { kind: 'tool-result', resultView: { card: 'read', path: 'x.ts' } } },
  }), [])
  assert.equal(canonicalWebUrl('file:///tmp/x.html'), undefined)
  assert.equal(canonicalWebUrl('data:text/html,hi'), undefined)
})

test('Canvas Web Node retains canonical URL independent of display content', () => {
  assert.equal(webUrlOfCanvasNode({
    data: { localKind: 'web', url: 'https://example.com/page#quote' },
  }), 'https://example.com/page')
  assert.equal(webUrlOfCanvasNode({ data: { localKind: 'note', url: 'https://example.com' } }), undefined)
  assert.equal(webHostLabel('https://sub.example.com/path'), 'sub.example.com')
})
