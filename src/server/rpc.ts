import type { WorkbenchAgentRegistryWithRuntime, WorkbenchAgentBridge } from './agent-bridge.js'
import type { BrowserSessionRegistry } from './browser-registry.js'
import type { WorkbenchScopeRegistry } from './scope-registry.js'
import type { DomSelection } from '../core/types.js'

export interface WorkbenchRpcRequest {
  sessionId: string
  method: string
  args?: Record<string, unknown>
}

/**
 * Transport-neutral Workbench RPC router. The installable npm package exposes
 * it through the Host's named same-origin webServer route; tests may call it
 * directly without involving transport.
 */
export class WorkbenchRpcRouter {
  constructor(
    private readonly agents: WorkbenchAgentRegistryWithRuntime,
    private readonly scopes: WorkbenchScopeRegistry,
    private readonly browsers: BrowserSessionRegistry,
    private readonly agentBridge: WorkbenchAgentBridge,
  ) {}

  async call(request: WorkbenchRpcRequest): Promise<unknown> {
    const sessionId = nonEmpty(request.sessionId, 'sessionId')
    const agent = this.agents.get(sessionId as never)
    if (agent === undefined) throw codedError('SESSION_NOT_LIVE', `Session is not live: ${sessionId}`)
    const args = request.args ?? {}

    switch (request.method) {
      case 'files.list': return this.service(sessionId, agent).list(optionalString(args.path))
      case 'files.open': return this.service(sessionId, agent).open(nonEmpty(args.path, 'path'))

      case 'changes.list': return this.service(sessionId, agent).listChangeSets()
      case 'changes.get': return this.service(sessionId, agent).getChangeSet(nonEmpty(args.changeSetId, 'changeSetId'))
      case 'changes.prepare': return this.service(sessionId, agent).prepareReview(nonEmpty(args.changeSetId, 'changeSetId'))
      case 'changes.reviewHunk': return this.service(sessionId, agent).reviewHunk(
        nonEmpty(args.changeSetId, 'changeSetId'),
        nonEmpty(args.path, 'path'),
        nonEmpty(args.hunkId, 'hunkId'),
        decision(args.decision),
      )
      case 'changes.apply': return this.service(sessionId, agent).apply(nonEmpty(args.changeSetId, 'changeSetId'), args.acceptAllPending === true)
      case 'changes.reject': return this.service(sessionId, agent).reject(nonEmpty(args.changeSetId, 'changeSetId'))
      case 'changes.restore': {
        await this.service(sessionId, agent).restore(nonEmpty(args.checkpointId, 'checkpointId'))
        return { restored: true }
      }

      case 'browser.tabs': return this.browsers.tabs(sessionId)
      case 'browser.newTab': {
        const tab = await this.browsers.newTab(sessionId, optionalString(args.url) ?? 'about:blank')
        return { tabId: tab.id, tabs: await this.browsers.tabs(sessionId) }
      }
      case 'browser.closeTab': {
        await this.browsers.closeTab(sessionId, nonEmpty(args.tabId, 'tabId'))
        return { tabs: await this.browsers.tabs(sessionId) }
      }
      case 'browser.preview': return (await this.browsers.getTab(sessionId, nonEmpty(args.tabId, 'tabId'))).preview()
      case 'browser.navigate': {
        const tab = await this.browsers.getTab(sessionId, nonEmpty(args.tabId, 'tabId'))
        await tab.navigate(nonEmpty(args.url, 'url'))
        return tab.preview()
      }
      case 'browser.back': {
        const tab = await this.browsers.getTab(sessionId, nonEmpty(args.tabId, 'tabId'))
        await tab.back()
        return tab.preview()
      }
      case 'browser.forward': {
        const tab = await this.browsers.getTab(sessionId, nonEmpty(args.tabId, 'tabId'))
        await tab.forward()
        return tab.preview()
      }
      case 'browser.reload': {
        const tab = await this.browsers.getTab(sessionId, nonEmpty(args.tabId, 'tabId'))
        await tab.reload()
        return tab.preview()
      }
      case 'browser.inspectPoint': {
        const tab = await this.browsers.getTab(sessionId, nonEmpty(args.tabId, 'tabId'))
        return tab.inspectPoint(numberArg(args.x, 'x'), numberArg(args.y, 'y'))
      }
      case 'browser.startObservability': {
        const tab = await this.browsers.getTab(sessionId, nonEmpty(args.tabId, 'tabId'))
        await tab.startObservability()
        return { started: true }
      }
      case 'browser.console': return (await this.browsers.getTab(sessionId, nonEmpty(args.tabId, 'tabId'))).consoleEntries()
      case 'browser.network': return (await this.browsers.getTab(sessionId, nonEmpty(args.tabId, 'tabId'))).networkEntries()

      case 'agent.webChange': return this.agentBridge.requestWebChange(sessionId, {
        tabId: nonEmpty(args.tabId, 'tabId'),
        selection: domSelection(args.selection),
        instruction: nonEmpty(args.instruction, 'instruction'),
      })
      case 'agent.textChange': return this.agentBridge.requestChange(sessionId, {
        artifactPath: nonEmpty(args.artifactPath, 'artifactPath'),
        selection: args.selection as any,
        instruction: nonEmpty(args.instruction, 'instruction'),
      })

      default: throw codedError('UNKNOWN_METHOD', `Unknown Workbench RPC method: ${request.method}`)
    }
  }

  private service(sessionId: string, agent: { session: { header: { cwd?: string } } }) {
    const cwd = agent.session.header.cwd
    if (typeof cwd !== 'string' || cwd.trim() === '') throw codedError('SESSION_NO_CWD', 'Session has no workspace cwd')
    return this.scopes.for({ sessionId, cwd })
  }
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw codedError('INVALID_ARGUMENT', `${name} must be a non-empty string`)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw codedError('INVALID_ARGUMENT', 'expected a string')
  return value
}

function numberArg(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw codedError('INVALID_ARGUMENT', `${name} must be a finite number`)
  return value
}

function decision(value: unknown): 'accepted' | 'rejected' {
  if (value !== 'accepted' && value !== 'rejected') throw codedError('INVALID_ARGUMENT', 'decision must be accepted or rejected')
  return value
}

function domSelection(value: unknown): DomSelection {
  if (typeof value !== 'object' || value === null) throw codedError('INVALID_ARGUMENT', 'selection must be an object')
  const row = value as Partial<DomSelection>
  if (row.kind !== 'dom-node') throw codedError('INVALID_ARGUMENT', 'selection.kind must be dom-node')
  return {
    kind: 'dom-node',
    artifactId: nonEmpty(row.artifactId, 'selection.artifactId'),
    version: nonEmpty(row.version, 'selection.version'),
    selector: nonEmpty(row.selector, 'selection.selector'),
    url: nonEmpty(row.url, 'selection.url'),
  }
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
