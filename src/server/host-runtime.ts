import os from 'node:os'
import path from 'node:path'
import { WorkbenchAgentBridge, type WorkbenchAgentRegistryWithRuntime, type WorkbenchAgentRuntimeAdapter } from './agent-bridge.js'
import { BrowserSessionRegistry } from './browser-registry.js'
import { registerWorkbenchHttpRoute, type WebServerRouteRegistrar } from './http-route.js'
import { WorkbenchRpcRouter } from './rpc.js'
import { WorkbenchScopeRegistry } from './scope-registry.js'

export interface WorkbenchHostConfig {
  stateDir?: string
  reviewRequired?: boolean
  routePath?: string
  maxBodyBytes?: number
  browser?: {
    executablePath?: string
    headless?: boolean
    persistProfiles?: boolean
    allowedDomains?: readonly string[]
    prohibitedDomains?: readonly string[]
    launchArgs?: readonly string[]
  }
}

export interface WorkbenchHostContextLike {
  agents: WorkbenchAgentRegistryWithRuntime
  webServer: WebServerRouteRegistrar
  on(event: 'agent/disposed', listener: (payload: { agent: { id?: unknown } }) => void): () => void
}

/** Runtime assembly for the npm-installed Host half. The object exists mainly
 * to make lifecycle ownership explicit and testable: route, per-session scope,
 * Browser processes, and Agent bridge all unwind together. */
export class WorkbenchHostRuntime {
  readonly stateDir: string
  readonly scopes: WorkbenchScopeRegistry
  readonly browsers: BrowserSessionRegistry
  readonly bridge: WorkbenchAgentBridge
  readonly router: WorkbenchRpcRouter

  private disposeRoute: (() => void) | undefined
  private disposeAgentListener: (() => void) | undefined
  private disposed = false

  constructor(
    private readonly ctx: WorkbenchHostContextLike,
    readonly config: WorkbenchHostConfig = {},
    runtime: WorkbenchAgentRuntimeAdapter,
  ) {
    this.stateDir = path.resolve(config.stateDir ?? process.env.DSH_WORKBENCH_HOME ?? path.join(os.homedir(), '.dsh', 'workbench'))
    this.scopes = new WorkbenchScopeRegistry({ stateDir: this.stateDir, reviewRequired: config.reviewRequired ?? true })
    this.browsers = new BrowserSessionRegistry({
      stateDir: this.stateDir,
      persistProfiles: config.browser?.persistProfiles ?? false,
      browser: {
        ...(config.browser?.executablePath === undefined ? {} : { executablePath: config.browser.executablePath }),
        headless: config.browser?.headless ?? true,
        ...(config.browser?.allowedDomains === undefined ? {} : { allowedDomains: config.browser.allowedDomains }),
        ...(config.browser?.prohibitedDomains === undefined ? {} : { prohibitedDomains: config.browser.prohibitedDomains }),
        ...(config.browser?.launchArgs === undefined ? {} : { launchArgs: config.browser.launchArgs }),
      },
    })
    this.bridge = new WorkbenchAgentBridge(ctx.agents, this.scopes, runtime, this.browsers)
    this.router = new WorkbenchRpcRouter(ctx.agents, this.scopes, this.browsers, this.bridge)
  }

  start(): void {
    if (this.disposed) throw new Error('WorkbenchHostRuntime is disposed')
    if (this.disposeRoute !== undefined) return
    this.disposeRoute = registerWorkbenchHttpRoute(this.ctx.webServer, this.router, {
      path: this.config.routePath,
      maxBodyBytes: this.config.maxBodyBytes,
    })
    this.disposeAgentListener = this.ctx.on('agent/disposed', ({ agent }) => {
      const sessionId = String(agent.id ?? '')
      if (!sessionId) return
      this.scopes.disposeSession(sessionId)
      void this.browsers.stop(sessionId)
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.disposeRoute?.()
    this.disposeRoute = undefined
    this.disposeAgentListener?.()
    this.disposeAgentListener = undefined
    this.scopes.clear()
    await this.browsers.dispose()
  }
}
