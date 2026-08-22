import type { BrowserConsoleEntry, BrowserNetworkEntry, BrowserPreview, BrowserTabInfo, WebSelectionResult } from '../browser/session.js'
import type { ChangeSet, HunkDecision } from '../core/types.js'
import type { WorkbenchClientTransport } from './transport.js'

export type WorkbenchSurface = 'browser' | 'changes' | 'console' | 'network'

export interface BrowserWorkbenchState {
  ready: boolean
  busy: boolean
  error?: string
  surface: WorkbenchSurface
  tabs: BrowserTabInfo[]
  activeTabId?: string
  preview?: BrowserPreview
  selected?: WebSelectionResult
  instruction: string
  changeSet?: ChangeSet
  comments: Record<string, string>
  console: BrowserConsoleEntry[]
  network: BrowserNetworkEntry[]
  lastCheckpointId?: string
  lastAppliedChangeSetId?: string
}

type Listener = (state: Readonly<BrowserWorkbenchState>) => void

const INITIAL: BrowserWorkbenchState = {
  ready: false,
  busy: false,
  surface: 'browser',
  tabs: [],
  instruction: '',
  comments: {},
  console: [],
  network: [],
}

/** UI/application controller for the browser workbench. It owns interaction
 * state but never filesystem/browser authority; every operation crosses the
 * Session-bound Host transport. */
export class BrowserWorkbenchController {
  private state: BrowserWorkbenchState = structuredClone(INITIAL)
  private readonly listeners = new Set<Listener>()

  constructor(readonly sessionId: string, private readonly transport: WorkbenchClientTransport) {
    if (!sessionId.trim()) throw new Error('sessionId must be non-empty')
  }

  snapshot(): Readonly<BrowserWorkbenchState> { return structuredClone(this.state) }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => { this.listeners.delete(listener) }
  }

  async init(): Promise<void> {
    await this.run(async () => {
      let tabs = await this.transport.call<BrowserTabInfo[]>(this.sessionId, 'browser.tabs')
      let active = tabs.find(tab => tab.type === 'page')
      if (active === undefined) {
        const created = await this.transport.call<{ tabId: string; tabs: BrowserTabInfo[] }>(this.sessionId, 'browser.newTab')
        tabs = created.tabs
        active = tabs.find(tab => tab.id === created.tabId) ?? tabs.find(tab => tab.type === 'page')
      }
      this.patch({ tabs, activeTabId: active?.id, ready: true })
      if (active !== undefined) {
        await this.transport.call(this.sessionId, 'browser.startObservability', { tabId: active.id })
        await this.refreshPreviewInternal(active.id)
      }
    })
  }

  setSurface(surface: WorkbenchSurface): void { this.patch({ surface }) }
  setInstruction(instruction: string): void { this.patch({ instruction }) }
  setComment(hunkId: string, comment: string): void { this.patch({ comments: { ...this.state.comments, [hunkId]: comment } }) }

  async refreshTabs(): Promise<void> {
    await this.run(async () => {
      const tabs = await this.transport.call<BrowserTabInfo[]>(this.sessionId, 'browser.tabs')
      const activeTabId = tabs.some(tab => tab.id === this.state.activeTabId) ? this.state.activeTabId : tabs.find(tab => tab.type === 'page')?.id
      this.patch({ tabs, activeTabId })
    })
  }

  async selectTab(tabId: string): Promise<void> {
    if (!this.state.tabs.some(tab => tab.id === tabId)) throw new Error(`Unknown tab ${tabId}`)
    await this.run(async () => {
      this.patch({ activeTabId: tabId, selected: undefined })
      await this.transport.call(this.sessionId, 'browser.startObservability', { tabId })
      await this.refreshPreviewInternal(tabId)
    })
  }

  async newTab(url = 'about:blank'): Promise<void> {
    await this.run(async () => {
      const created = await this.transport.call<{ tabId: string; tabs: BrowserTabInfo[] }>(this.sessionId, 'browser.newTab', { url })
      this.patch({ tabs: created.tabs, activeTabId: created.tabId, selected: undefined })
      await this.transport.call(this.sessionId, 'browser.startObservability', { tabId: created.tabId })
      await this.refreshPreviewInternal(created.tabId)
    })
  }

  async closeActiveTab(): Promise<void> {
    const tabId = this.requireTab()
    await this.run(async () => {
      const result = await this.transport.call<{ tabs: BrowserTabInfo[] }>(this.sessionId, 'browser.closeTab', { tabId })
      const next = result.tabs.find(tab => tab.type === 'page')
      this.patch({ tabs: result.tabs, activeTabId: next?.id, preview: undefined, selected: undefined })
      if (next !== undefined) await this.refreshPreviewInternal(next.id)
    })
  }

  async navigate(url: string): Promise<void> {
    const tabId = this.requireTab()
    if (!url.trim()) throw new Error('URL must be non-empty')
    await this.run(async () => {
      const preview = await this.transport.call<BrowserPreview>(this.sessionId, 'browser.navigate', { tabId, url: url.trim() })
      await this.syncAfterNavigation(preview)
    })
  }

  async back(): Promise<void> { await this.navigationCommand('browser.back') }
  async forward(): Promise<void> { await this.navigationCommand('browser.forward') }
  async reload(): Promise<void> { await this.navigationCommand('browser.reload') }
  async refreshPreview(): Promise<void> { await this.run(() => this.refreshPreviewInternal(this.requireTab())) }

  /** Inspect a point expressed as a 0..1 fraction of the screenshot. The Host
   * receives CSS-pixel viewport coordinates, so UI scaling does not corrupt
   * element targeting. */
  async inspectNormalized(xRatio: number, yRatio: number): Promise<void> {
    const tabId = this.requireTab()
    const preview = this.state.preview
    if (preview === undefined) throw new Error('No browser preview is loaded')
    if (![xRatio, yRatio].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('Inspect coordinates must be normalized to 0..1')
    await this.run(async () => {
      const selected = await this.transport.call<WebSelectionResult>(this.sessionId, 'browser.inspectPoint', {
        tabId,
        x: xRatio * preview.viewport.width,
        y: yRatio * preview.viewport.height,
      })
      this.patch({ selected })
    })
  }

  async askAgent(): Promise<void> {
    const selected = this.state.selected
    if (selected === undefined) throw new Error('Select a page element first')
    const instruction = this.state.instruction.trim()
    if (!instruction) throw new Error('Describe the requested change first')
    const tabId = this.requireTab()
    await this.run(async () => {
      const result = await this.transport.call<{ taskId: string; changeSet: ChangeSet }>(this.sessionId, 'agent.webChange', {
        tabId,
        selection: selected.selection,
        instruction,
      })
      const prepared = await this.transport.call<ChangeSet>(this.sessionId, 'changes.prepare', { changeSetId: result.changeSet.id })
      this.patch({ changeSet: prepared, surface: 'changes', comments: {} })
    })
  }

  async reviewHunk(path: string, hunkId: string, decision: Exclude<HunkDecision, 'pending'>): Promise<void> {
    const changeSetId = this.requireChangeSet().id
    await this.run(async () => {
      const changeSet = await this.transport.call<ChangeSet>(this.sessionId, 'changes.reviewHunk', { changeSetId, path, hunkId, decision })
      this.patch({ changeSet })
    })
  }

  async acceptAll(): Promise<void> { await this.reviewAll('accepted') }
  async rejectAll(): Promise<void> { await this.reviewAll('rejected') }

  async reviseFromComments(): Promise<void> {
    const current = this.requireChangeSet()
    const selected = this.state.selected
    if (selected === undefined) throw new Error('The original web selection is no longer available')
    const feedback = Object.entries(this.state.comments).filter(([, value]) => value.trim()).map(([id, value]) => `- ${id}: ${value.trim()}`)
    if (feedback.length === 0) throw new Error('Add at least one review comment before asking for a revision')
    const original = this.state.instruction.trim()
    const tabId = this.requireTab()
    await this.run(async () => {
      if (current.status === 'proposed') await this.transport.call(this.sessionId, 'changes.reject', { changeSetId: current.id })
      const instruction = `${original}\n\nReviewer feedback on the previous proposal:\n${feedback.join('\n')}\nReturn a revised complete proposal.`
      const result = await this.transport.call<{ taskId: string; changeSet: ChangeSet }>(this.sessionId, 'agent.webChange', {
        tabId, selection: selected.selection, instruction,
      })
      const changeSet = await this.transport.call<ChangeSet>(this.sessionId, 'changes.prepare', { changeSetId: result.changeSet.id })
      this.patch({ changeSet, comments: {}, surface: 'changes' })
    })
  }

  async applyReviewed(): Promise<void> {
    const id = this.requireChangeSet().id
    await this.run(async () => {
      const applied = await this.transport.call<ChangeSet>(this.sessionId, 'changes.apply', { changeSetId: id })
      this.patch({
        changeSet: applied,
        lastCheckpointId: applied.checkpointId,
        lastAppliedChangeSetId: applied.id,
        surface: 'browser',
      })
      // In a live dev server this is the preview verification boundary. A Host
      // navigation policy may refuse reload; keep the applied ChangeSet visible
      // and surface the failure rather than pretending verification happened.
      const tabId = this.state.activeTabId
      if (tabId !== undefined) {
        const preview = await this.transport.call<BrowserPreview>(this.sessionId, 'browser.reload', { tabId })
        await this.syncAfterNavigation(preview)
      }
    })
  }

  async undoLastApply(): Promise<void> {
    const checkpointId = this.state.lastCheckpointId
    if (checkpointId === undefined) throw new Error('No applied checkpoint is available to restore')
    await this.run(async () => {
      await this.transport.call(this.sessionId, 'changes.restore', { checkpointId })
      const tabId = this.state.activeTabId
      if (tabId !== undefined) {
        const preview = await this.transport.call<BrowserPreview>(this.sessionId, 'browser.reload', { tabId })
        await this.syncAfterNavigation(preview)
      }
      this.patch({ lastCheckpointId: undefined, lastAppliedChangeSetId: undefined, changeSet: undefined, surface: 'browser' })
    })
  }

  async refreshDiagnostics(): Promise<void> {
    const tabId = this.requireTab()
    await this.run(async () => {
      const [consoleEntries, network] = await Promise.all([
        this.transport.call<BrowserConsoleEntry[]>(this.sessionId, 'browser.console', { tabId }),
        this.transport.call<BrowserNetworkEntry[]>(this.sessionId, 'browser.network', { tabId }),
      ])
      this.patch({ console: consoleEntries, network })
    })
  }

  private async navigationCommand(method: 'browser.back' | 'browser.forward' | 'browser.reload'): Promise<void> {
    const tabId = this.requireTab()
    await this.run(async () => {
      const preview = await this.transport.call<BrowserPreview>(this.sessionId, method, { tabId })
      await this.syncAfterNavigation(preview)
    })
  }

  private async syncAfterNavigation(preview: BrowserPreview): Promise<void> {
    this.patch({ preview, selected: undefined })
    const tabs = await this.transport.call<BrowserTabInfo[]>(this.sessionId, 'browser.tabs')
    this.patch({ tabs })
  }

  private async refreshPreviewInternal(tabId: string): Promise<void> {
    const preview = await this.transport.call<BrowserPreview>(this.sessionId, 'browser.preview', { tabId })
    this.patch({ preview })
  }

  private async reviewAll(decision: Exclude<HunkDecision, 'pending'>): Promise<void> {
    const current = this.requireChangeSet()
    await this.run(async () => {
      let latest = current
      for (const diff of current.diffs ?? []) {
        const review = latest.reviews?.find(row => row.path === diff.path)
        for (const hunk of diff.hunks) {
          if (review?.decisions[hunk.id] === decision) continue
          latest = await this.transport.call<ChangeSet>(this.sessionId, 'changes.reviewHunk', {
            changeSetId: current.id, path: diff.path, hunkId: hunk.id, decision,
          })
        }
      }
      this.patch({ changeSet: latest })
    })
  }

  private requireTab(): string {
    if (this.state.activeTabId === undefined) throw new Error('No active browser tab')
    return this.state.activeTabId
  }

  private requireChangeSet(): ChangeSet {
    if (this.state.changeSet === undefined) throw new Error('No active ChangeSet')
    return this.state.changeSet
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    this.patch({ busy: true, error: undefined })
    try {
      await operation()
    } catch (error) {
      this.patch({ error: formatError(error) })
      throw error
    } finally {
      this.patch({ busy: false })
    }
  }

  private patch(patch: Partial<BrowserWorkbenchState>): void {
    this.state = { ...this.state, ...patch }
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
