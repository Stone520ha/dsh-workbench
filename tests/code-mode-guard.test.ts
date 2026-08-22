import test from 'node:test'
import assert from 'node:assert/strict'
import { workbenchMutationGuard, WORKBENCH_DENIED_MUTATION_TOOLS } from '../src/server/agent-bridge.js'

/**
 * Contract simulation for DSH Code Mode. DSH run_code builds a nested input with
 * `name` equal to the actual bound tool and sends it through scheduler.prepare(),
 * whose documented pipeline includes pre-execute + monotonic guards.
 */
function prepareNested(name: string): { kind: 'dispatch' } | { kind: 'denied'; reason: string } {
  const reason = workbenchMutationGuard({ name })
  return reason === undefined ? { kind: 'dispatch' } : { kind: 'denied', reason }
}

test('outer run_code remains available while nested mutation tools are denied', () => {
  assert.equal(workbenchMutationGuard({ name: 'run_code' }), undefined)
  assert.deepEqual(prepareNested('read'), { kind: 'dispatch' })
  assert.deepEqual(prepareNested('grep'), { kind: 'dispatch' })
  assert.deepEqual(prepareNested('workbench_propose'), { kind: 'dispatch' })
  for (const name of WORKBENCH_DENIED_MUTATION_TOOLS) {
    const result = prepareNested(name)
    assert.equal(result.kind, 'denied', `${name} must be denied when reached from Code Mode`)
    if (result.kind === 'denied') assert.match(result.reason, /Workbench review mode/)
  }
})

test('Code Mode cannot use tools.write as a mutation escape hatch', () => {
  // This models: run_code({ code: 'await tools.write(...)' }) -> nested scheduler.prepare(input{name:'write'})
  const outer = prepareNested('run_code')
  assert.equal(outer.kind, 'dispatch')
  const nested = prepareNested('write')
  assert.equal(nested.kind, 'denied')
})
