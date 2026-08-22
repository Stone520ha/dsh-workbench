import path from 'node:path'
import { WorkbenchService } from './service.js'

export interface WorkbenchScopeRegistryOptions {
  stateDir: string
  reviewRequired?: boolean
}

interface ScopeEntry {
  sessionId: string
  root: string
  service: WorkbenchService
}

export class WorkbenchScopeRegistry {
  private readonly services = new Map<string, ScopeEntry>()
  constructor(private readonly options: WorkbenchScopeRegistryOptions) {}

  for(scope: { sessionId: string; cwd: string }): WorkbenchService {
    const root = path.resolve(scope.cwd)
    const key = `${scope.sessionId}\0${root}`
    let entry = this.services.get(key)
    if (entry === undefined) {
      entry = {
        sessionId: scope.sessionId,
        root,
        service: new WorkbenchService(root, {
          stateDir: path.join(this.options.stateDir, encodeURIComponent(scope.sessionId)),
          reviewRequired: this.options.reviewRequired,
        }),
      }
      this.services.set(key, entry)
    }
    return entry.service
  }

  disposeSession(sessionId: string): void {
    for (const [key, entry] of this.services) {
      if (entry.sessionId === sessionId) this.services.delete(key)
    }
  }

  clear(): void { this.services.clear() }
  activeSessionIds(): string[] { return [...new Set([...this.services.values()].map(entry => entry.sessionId))] }
}
