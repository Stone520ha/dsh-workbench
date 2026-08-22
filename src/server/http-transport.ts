import type { WorkbenchScopeRegistry } from './scope-registry.js'

export interface WorkbenchAgentRegistryLike {
  get(sessionId: string): { session: { header: { cwd?: string } } } | undefined
}

export interface WorkbenchCall {
  sessionId: string
  method: string
  args?: unknown[]
}

export async function dispatchWorkbenchCall(
  agents: WorkbenchAgentRegistryLike,
  scopes: WorkbenchScopeRegistry,
  call: WorkbenchCall,
): Promise<unknown> {
  const agent = agents.get(call.sessionId)
  if (agent === undefined) throw codedError('SESSION_NOT_LIVE', `Session is not live: ${call.sessionId}`)
  const cwd = agent.session.header.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') throw codedError('SESSION_NO_CWD', 'Session has no workspace cwd')
  const service = scopes.for({ sessionId: call.sessionId, cwd })
  const args = call.args ?? []
  switch (call.method) {
    case 'list': return service.list(args[0] as string | undefined)
    case 'open': return service.open(String(args[0] ?? ''))
    case 'propose': return service.propose(String(args[0] ?? ''), args[1] as any[], args[2] as any)
    case 'prepareReview': return service.prepareReview(String(args[0]))
    case 'reviewHunk': return service.reviewHunk(String(args[0]), String(args[1]), String(args[2]), args[3] as 'accepted' | 'rejected')
    case 'apply': return service.apply(String(args[0]), Boolean(args[1]))
    case 'reject': return service.reject(String(args[0]))
    case 'restore': return service.restore(String(args[0]))
    case 'getChangeSet': return service.getChangeSet(String(args[0]))
    case 'listChangeSets': return service.listChangeSets()
    default: throw codedError('UNKNOWN_METHOD', `Unknown Workbench method: ${call.method}`)
  }
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
